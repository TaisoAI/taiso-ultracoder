import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { Logger, MergeStrategy } from "@ultracoder/core";
import type { MergeQueueEntry, MergeResult } from "./merge-queue.js";

const execFile = promisify(execFileCb);

export interface MergeExecutorConfig {
	/** Ordered list of strategies to try. @default ["squash", "rebase", "merge"] */
	strategies: MergeStrategy[];
	/** Max retry attempts per entry before escalating. @default 2 */
	maxRetries: number;
	/** Branch to merge into. @default "main" */
	targetBranch: string;
	/** Repository root directory. */
	cwd: string;
}

const DEFAULT_CONFIG: Omit<MergeExecutorConfig, "cwd"> = {
	strategies: ["squash", "rebase", "merge"],
	maxRetries: 2,
	targetBranch: "main",
};

interface StrategyAttempt {
	strategy: MergeStrategy;
	success: boolean;
	error?: string;
}

/**
 * Executes git merge operations with strategy fallback and conflict detection.
 */
export class MergeExecutor {
	private readonly config: MergeExecutorConfig;
	private readonly logger: Logger;

	// Exposed for testing — callers can override to inject a mock.
	execFile: typeof execFile = execFile;

	constructor(
		config: Partial<MergeExecutorConfig> & Pick<MergeExecutorConfig, "cwd">,
		logger: Logger,
	) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.logger = logger.child({ component: "merge-executor" });
	}

	/**
	 * Attempt to merge the given entry's branch into the target branch.
	 * Tries each configured strategy in order, returning on first success.
	 * Always ensures clean git state in finally blocks.
	 */
	async executeMerge(entry: MergeQueueEntry): Promise<MergeResult> {
		if (entry.attempts >= this.config.maxRetries) {
			return { status: "failed", error: `Exceeded max retries (${this.config.maxRetries})` };
		}

		entry.attempts += 1;

		const attempts: StrategyAttempt[] = [];

		for (const strategy of this.config.strategies) {
			try {
				const result = await this.tryStrategy(entry.branch, strategy);
				attempts.push({ strategy, success: true });
				this.logger.info(`Merge succeeded with strategy '${strategy}'`, {
					branch: entry.branch,
					sessionId: entry.sessionId,
				});
				return result;
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				attempts.push({ strategy, success: false, error: message });
				this.logger.warn(`Strategy '${strategy}' failed for branch '${entry.branch}'`, {
					error: message,
				});
			} finally {
				await this.ensureCleanState();
			}
		}

		// All strategies exhausted
		if (entry.attempts < this.config.maxRetries) {
			return { status: "retry", attempt: entry.attempts };
		}

		const details = attempts.map((a) => `${a.strategy}: ${a.error ?? "unknown"}`).join("; ");
		return { status: "conflict", details };
	}

	/**
	 * Reset the working tree to a clean state.
	 */
	async ensureCleanState(): Promise<void> {
		const opts = { cwd: this.config.cwd };
		try {
			await this.execFile("git", ["reset", "--hard", "HEAD"], opts);
			await this.execFile("git", ["clean", "-fd"], opts);
		} catch (err) {
			this.logger.error("Failed to ensure clean state", {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	/**
	 * Execute a single merge strategy against the target branch.
	 */
	private async tryStrategy(branch: string, strategy: MergeStrategy): Promise<MergeResult> {
		const opts = { cwd: this.config.cwd };

		// Checkout target branch
		await this.execFile("git", ["checkout", this.config.targetBranch], opts);

		try {
			switch (strategy) {
				case "squash": {
					await this.execFile("git", ["merge", "--squash", branch], opts);
					await this.execFile("git", ["commit", "-m", `Squash merge branch '${branch}'`], opts);
					break;
				}
				case "rebase": {
					await this.execFile("git", ["rebase", branch], opts);
					break;
				}
				case "merge": {
					await this.execFile("git", ["merge", "--no-ff", branch], opts);
					break;
				}
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (message.includes("CONFLICT")) {
				throw new Error(`Conflict detected during ${strategy}: ${message}`);
			}
			throw new Error(`Strategy '${strategy}' failed: ${message}`);
		}

		return { status: "merged", strategy };
	}
}
