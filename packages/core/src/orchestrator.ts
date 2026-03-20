import type { Deps, Logger } from "./types.js";

// ─── Orchestrator Configuration ─────────────────────────────────────

export interface OrchestratorConfig {
	/** Interval between orchestration cycles in milliseconds (default: 30000) */
	pollIntervalMs: number;
	/** Whether to delegate ambiguous decisions to an LLM agent (default: false) */
	enableLLMDecisions: boolean;
	/** Path to the agent CLI binary, used when enableLLMDecisions is true */
	agentPath?: string;
}

const DEFAULT_CONFIG: OrchestratorConfig = {
	pollIntervalMs: 30_000,
	enableLLMDecisions: false,
};

// ─── Orchestrator Callbacks ─────────────────────────────────────────

export interface OrchestratorCallbacks {
	/** Poll all active sessions and update their status */
	pollSessions: () => Promise<void>;
	/** Process the merge queue (approve / merge ready PRs) */
	processMergeQueue: () => Promise<void>;
	/** Run the reconciler to detect and fix drift */
	runReconciler: () => Promise<{ healthy: boolean; fixes: string[] }>;
	/** Optional: decompose a high-level task into sub-tasks */
	decomposeTask?: (task: string) => Promise<void>;
	/** Optional: poll for new issues and triage them */
	pollIssues?: () => Promise<void>;
}

// ─── Orchestrator ───────────────────────────────────────────────────

export class Orchestrator {
	private timer: ReturnType<typeof setInterval> | null = null;
	private readonly config: OrchestratorConfig;
	private readonly callbacks: OrchestratorCallbacks;
	private readonly deps: Deps;
	private readonly logger: Logger;
	private cycleCount = 0;
	private cycleInProgress = false;

	constructor(deps: Deps, callbacks: OrchestratorCallbacks, config?: Partial<OrchestratorConfig>) {
		this.deps = deps;
		this.callbacks = callbacks;
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.logger = deps.logger.child({ component: "orchestrator" });
	}

	/** Start the periodic orchestration loop. */
	start(): void {
		if (this.timer) {
			this.logger.warn("Orchestrator already running");
			return;
		}

		this.logger.info("Orchestrator starting", {
			pollIntervalMs: this.config.pollIntervalMs,
			enableLLMDecisions: this.config.enableLLMDecisions,
		});

		// Run first cycle immediately, then on interval
		void this.runCycle();
		this.timer = setInterval(() => {
			void this.runCycle();
		}, this.config.pollIntervalMs);
	}

	/** Stop the periodic orchestration loop. */
	stop(): void {
		if (!this.timer) {
			this.logger.warn("Orchestrator is not running");
			return;
		}

		clearInterval(this.timer);
		this.timer = null;
		this.logger.info("Orchestrator stopped", { cyclesCompleted: this.cycleCount });
	}

	/** Whether the orchestrator loop is currently active. */
	get running(): boolean {
		return this.timer !== null;
	}

	/** Execute a single orchestration cycle. */
	async runCycle(): Promise<void> {
		if (this.cycleInProgress) return;
		this.cycleInProgress = true;
		try {
			await this.doCycle();
		} finally {
			this.cycleInProgress = false;
		}
	}

	private async doCycle(): Promise<void> {
		this.cycleCount++;
		const cycleId = this.cycleCount;

		this.logger.debug("Cycle start", { cycleId });

		try {
			// 1. Poll sessions (deterministic)
			await this.callbacks.pollSessions();

			// 2. Process merge queue (deterministic)
			await this.callbacks.processMergeQueue();

			// 3. Run reconciler every 5th cycle to avoid excessive checks
			if (cycleId % 5 === 0) {
				const result = await this.callbacks.runReconciler();
				if (!result.healthy) {
					this.logger.warn("Reconciler found issues", { fixes: result.fixes });
				}
			}

			// 4. Poll for new issues if callback is configured
			if (this.callbacks.pollIssues) {
				await this.callbacks.pollIssues();
			}

			// 5. If LLM decisions enabled, future hook for ambiguous situations
			if (this.config.enableLLMDecisions) {
				this.logger.debug("LLM decision hook (not yet implemented)", { cycleId });
			}
		} catch (err) {
			this.logger.error("Cycle failed", {
				cycleId,
				error: err instanceof Error ? err.message : String(err),
			});
		}

		this.logger.debug("Cycle complete", { cycleId });
	}
}
