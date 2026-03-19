import type { Deps, Logger, Session, SessionStatus } from "@ultracoder/core";
import { detectActivity, isStuck } from "./activity-detector.js";
import { type ReactionAction, evaluateReaction } from "./reactions.js";
import { canTransition } from "./state-machine.js";

export interface WorkerConfig {
	pollIntervalMs: number;
	maxIdleMs: number;
	enabled: boolean;
}

const DEFAULT_CONFIG: WorkerConfig = {
	pollIntervalMs: 30_000,
	maxIdleMs: 300_000, // 5 minutes
	enabled: true,
};

/** Statuses the worker actively monitors. */
const ACTIVE_STATUSES: SessionStatus[] = [
	"working",
	"pr_open",
	"review_pending",
	"approved",
	"mergeable",
];

/**
 * Lifecycle worker: polls sessions on an interval,
 * detects activity, manages state transitions, triggers reactions.
 */
export class LifecycleWorker {
	private timer: ReturnType<typeof setInterval> | null = null;
	private pollInProgress = false;
	private readonly config: WorkerConfig;
	private readonly deps: Deps;
	private readonly logger: Logger;

	constructor(deps: Deps, config?: Partial<WorkerConfig>) {
		this.deps = deps;
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.logger = deps.logger.child({ component: "lifecycle-worker" });
	}

	start(): void {
		if (!this.config.enabled) return;
		if (this.timer) return;

		this.logger.info("Starting lifecycle worker", {
			pollIntervalMs: this.config.pollIntervalMs,
		});

		this.timer = setInterval(() => {
			this.poll().catch((err) => {
				this.logger.error("Poll cycle failed", { error: String(err) });
			});
		}, this.config.pollIntervalMs);

		// Run immediately
		this.poll().catch((err) => {
			this.logger.error("Initial poll failed", { error: String(err) });
		});
	}

	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
			this.logger.info("Lifecycle worker stopped");
		}
	}

	async poll(): Promise<void> {
		if (this.pollInProgress) return;
		this.pollInProgress = true;
		try {
			await this.doPoll();
		} finally {
			this.pollInProgress = false;
		}
	}

	private async doPoll(): Promise<void> {
		// Query all active statuses; the SessionManager.list() filter only takes
		// a single status, so we issue parallel calls and deduplicate by id.
		const results = await Promise.all(
			ACTIVE_STATUSES.map((status) => this.deps.sessions.list({ status })),
		);
		const seen = new Set<string>();
		const sessions: Session[] = [];
		for (const batch of results) {
			for (const s of batch) {
				if (!seen.has(s.id)) {
					seen.add(s.id);
					sessions.push(s);
				}
			}
		}

		for (const session of sessions) {
			try {
				await this.checkSession(session);
			} catch (err) {
				this.logger.error(`Failed to check session '${session.id}'`, {
					error: String(err),
				});
			}
		}
	}

	private async checkSession(session: Session): Promise<void> {
		// Step 1: Runtime alive check
		try {
			if (session.runtimeId) {
				const runtime = this.deps.plugins.get("runtime");
				if (runtime) {
					const alive = await runtime.isAlive({ id: session.runtimeId });
					if (!alive && session.status === "working") {
						const t = canTransition(session.status, "fail");
						if (t.valid) {
							await this.deps.sessions.update(session.id, { status: "failed" });
							evaluateReaction("stuck", session, this.logger);
							return;
						}
					}
				}
			}
		} catch (err) {
			this.logger.error(`Runtime alive check failed for session '${session.id}'`, {
				error: String(err),
			});
		}

		// Step 2: Agent activity detection
		let summary: Awaited<ReturnType<typeof detectActivity>> | undefined;
		try {
			const logPath = `${this.deps.paths.logsDir(session.id)}/activity.jsonl`;
			summary = await detectActivity(logPath);
		} catch (err) {
			this.logger.error(`Activity detection failed for session '${session.id}'`, {
				error: String(err),
			});
			return;
		}

		// Step 3: Agent completion → open PR
		try {
			if (summary.isCompleted && session.status === "working") {
				const transition = canTransition(session.status, "open_pr");
				if (transition.valid) {
					await this.deps.sessions.update(session.id, {
						status: "pr_open",
						completedAt: new Date().toISOString(),
					});
					const action = evaluateReaction("completed", session, this.logger);
					await this.executeAction(action, session);
				}
				return;
			}
		} catch (err) {
			this.logger.error(`Completion detection failed for session '${session.id}'`, {
				error: String(err),
			});
		}

		// Step 4: PR state detection (for pr_open, review_pending, approved, mergeable states)
		try {
			if (["pr_open", "review_pending", "approved", "mergeable"].includes(session.status)) {
				await this.checkPRState(session);
				return;
			}
		} catch (err) {
			this.logger.error(`PR state check failed for session '${session.id}'`, {
				error: String(err),
			});
		}

		// Step 5: Stuck detection (for working sessions)
		try {
			if (session.status === "working" && isStuck(summary, this.config.maxIdleMs)) {
				this.logger.warn(`Session '${session.id}' appears stuck`);
				const action = evaluateReaction("stuck", session, this.logger);
				await this.executeAction(action, session);
			}
		} catch (err) {
			this.logger.error(`Stuck detection failed for session '${session.id}'`, {
				error: String(err),
			});
		}
	}

	private async checkPRState(session: Session): Promise<void> {
		const scm = this.deps.plugins.get("scm");
		if (!scm || !session.metadata.prId) return;

		const prId = String(session.metadata.prId);
		const prStatus = await scm.getPRStatus(prId);

		// CI failed
		if (prStatus.ciStatus.state === "failure" || prStatus.ciStatus.state === "error") {
			const t = canTransition(session.status, "ci_fail");
			if (t.valid) {
				await this.deps.sessions.update(session.id, { status: "ci_failed" });
				const action = evaluateReaction("ci_fail", session, this.logger);
				await this.executeAction(action, session);
			}
			return;
		}

		// Review decisions
		if (session.status === "pr_open" || session.status === "review_pending") {
			if (prStatus.reviewDecision === "approved") {
				// Advance through request_review → approve chain
				if (session.status === "pr_open") {
					const t = canTransition("pr_open", "request_review");
					if (t.valid) {
						await this.deps.sessions.update(session.id, { status: "review_pending" });
					}
				}
				// Re-read after possible update
				const fresh = await this.deps.sessions.get(session.id);
				if (fresh && canTransition(fresh.status, "approve").valid) {
					await this.deps.sessions.update(session.id, { status: "approved" });
				}
			} else if (prStatus.reviewDecision === "changes_requested") {
				const t = canTransition(session.status, "request_changes");
				if (t.valid) {
					await this.deps.sessions.update(session.id, { status: "changes_requested" });
					const action = evaluateReaction("review_requested", session, this.logger);
					await this.executeAction(action, session);
				}
			}
		}

		// Merge conflicts
		if (!prStatus.mergeable && session.status !== "merge_conflicts") {
			const t = canTransition(session.status, "conflict");
			if (t.valid) {
				await this.deps.sessions.update(session.id, { status: "merge_conflicts" });
				const action = evaluateReaction("conflict", session, this.logger);
				await this.executeAction(action, session);
			}
			return;
		}

		// Mergeable (CI green + approved)
		if (session.status === "approved" && prStatus.ciStatus.state === "success") {
			const t = canTransition("approved", "ci_pass");
			if (t.valid) {
				await this.deps.sessions.update(session.id, { status: "mergeable" });
			}
		}
	}

	private async executeAction(action: ReactionAction, session: Session): Promise<void> {
		switch (action.type) {
			case "notify": {
				const notifier = this.deps.plugins.get("notifier");
				if (notifier) {
					await notifier.notify({
						title: `Session ${session.id}`,
						body: action.message,
						level: "info",
						sessionId: session.id,
					});
				}
				break;
			}
			case "pause": {
				const transition = canTransition(session.status, "conflict");
				if (transition.valid) {
					await this.deps.sessions.update(session.id, { status: "merge_conflicts" });
				}
				break;
			}
			case "retry": {
				const transition = canTransition(session.status, "resolve");
				if (transition.valid) {
					await this.deps.sessions.update(session.id, { status: "working" });
				}
				break;
			}
			case "kill": {
				const transition = canTransition(session.status, "kill");
				if (transition.valid) {
					await this.deps.sessions.update(session.id, { status: "killed" });
				}
				break;
			}
			case "resume":
			case "escalate":
				// These require human intervention or additional context
				this.logger.info(`Action '${action.type}' requires manual handling`, {
					sessionId: session.id,
				});
				break;
		}
	}
}
