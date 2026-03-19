import type { Logger } from "@ultracoder/core";
import type { MergeQueue } from "./merge-queue.js";
import type { ReconcilerConfig, ReconcilerResult } from "./reconciler.js";
import { reconcile } from "./reconciler.js";

export interface FinalizationConfig {
	/** Maximum corrective cycles to run. Default: 3. */
	maxCycles: number;
	/** Configuration passed to the reconciler each cycle. */
	reconcilerConfig: ReconcilerConfig;
}

export interface FinalizationResult {
	cycles: number;
	fixesSpawned: number;
	finalHealth: boolean;
	reconcilerResults: ReconcilerResult[];
}

/**
 * Post-completion finalization loop.
 * Runs corrective cycles: drain merge queue -> reconcile -> report fixes needed -> repeat.
 */
export async function finalize(
	mergeQueue: MergeQueue,
	config: FinalizationConfig,
	logger: Logger,
): Promise<FinalizationResult> {
	const results: ReconcilerResult[] = [];
	let totalFixes = 0;

	for (let cycle = 0; cycle < config.maxCycles; cycle++) {
		logger.info(`Finalization cycle ${cycle + 1}/${config.maxCycles}`);

		// 1. Drain merge queue
		while (mergeQueue.length > 0) {
			mergeQueue.dequeue();
		}

		// 2. Run reconciler
		const result = await reconcile(config.reconcilerConfig, logger);
		results.push(result);

		// 3. If healthy, exit early
		if (result.healthy) {
			logger.info(`Finalization complete after ${cycle + 1} cycle(s) — healthy`);
			return {
				cycles: cycle + 1,
				fixesSpawned: totalFixes,
				finalHealth: true,
				reconcilerResults: results,
			};
		}

		// 4. Report fixes needed (in production, would spawn fix agents)
		totalFixes += result.fixDescriptions.length;
		logger.warn(`Cycle ${cycle + 1}: ${result.fixDescriptions.length} fixes needed`, {
			fixes: result.fixDescriptions,
		});
	}

	return {
		cycles: config.maxCycles,
		fixesSpawned: totalFixes,
		finalHealth: false,
		reconcilerResults: results,
	};
}
