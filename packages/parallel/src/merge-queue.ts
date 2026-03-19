import type { Logger, MergeStrategy } from "@ultracoder/core";

export interface MergeQueueEntry {
	sessionId: string;
	branch: string;
	priority: number;
	addedAt: string;
	attempts: number;
	maxAttempts: number;
}

export type MergeResult =
	| { status: "merged"; strategy: MergeStrategy }
	| { status: "conflict"; details: string }
	| { status: "failed"; error: string }
	| { status: "retry"; attempt: number };

/**
 * Serial merge queue with priority ordering.
 * Processes branches one at a time to avoid conflicts.
 */
export class MergeQueue {
	private readonly queue: MergeQueueEntry[] = [];
	private processing = false;
	private readonly logger: Logger;

	constructor(logger: Logger) {
		this.logger = logger.child({ component: "merge-queue" });
	}

	/**
	 * Add a branch to the merge queue.
	 */
	enqueue(entry: Omit<MergeQueueEntry, "addedAt" | "attempts" | "maxAttempts">): void {
		this.queue.push({
			...entry,
			addedAt: new Date().toISOString(),
			attempts: 0,
			maxAttempts: 3,
		});
		// Sort by priority (higher first)
		this.queue.sort((a, b) => b.priority - a.priority);
		this.logger.info(`Enqueued branch '${entry.branch}'`, { priority: entry.priority });
	}

	/**
	 * Get the next entry to process.
	 */
	peek(): MergeQueueEntry | undefined {
		return this.queue[0];
	}

	/**
	 * Remove the front entry (after successful merge).
	 */
	dequeue(): MergeQueueEntry | undefined {
		return this.queue.shift();
	}

	/**
	 * Get current queue length.
	 */
	get length(): number {
		return this.queue.length;
	}

	/**
	 * Get all entries.
	 */
	entries(): readonly MergeQueueEntry[] {
		return this.queue;
	}

	/**
	 * Remove a specific session's entry.
	 */
	remove(sessionId: string): boolean {
		const idx = this.queue.findIndex((e) => e.sessionId === sessionId);
		if (idx === -1) return false;
		this.queue.splice(idx, 1);
		return true;
	}
}

/**
 * Strategy fallback: try merge strategies in order until one succeeds.
 */
export function fallbackStrategies(): MergeStrategy[] {
	return ["squash", "rebase", "merge"];
}
