import type { Deps, Logger, Session } from "@ultracoder/core";
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
		const sessions = await this.deps.sessions.list({ status: "working" });

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
		const logPath = `${this.deps.paths.logsDir(session.id)}/activity.jsonl`;
		const summary = await detectActivity(logPath);

		if (summary.isCompleted) {
			// Agent finished coding — transition to open PR
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

		if (isStuck(summary, this.config.maxIdleMs)) {
			this.logger.warn(`Session '${session.id}' appears stuck`);
			const action = evaluateReaction("stuck", session, this.logger);
			await this.executeAction(action, session);
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
