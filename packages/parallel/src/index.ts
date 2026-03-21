// @ultracoder/parallel — decomposer, scope tracker, merge queue, reconciler

export {
	decomposeTask,
	decomposeRecursive,
	shouldDecompose,
	parseDecompositionOutput,
	validateScopes,
	buildExecutionOrder,
} from "./decomposer.js";
export type {
	SubTask,
	DecompositionResult,
	DecomposerConfig,
} from "./decomposer.js";

export { ScopeTracker, executeHandoff } from "./scope-tracker.js";
export type { ScopeEntry, ScopeEvent, HandoffRequest } from "./scope-tracker.js";

export { MergeQueue, fallbackStrategies } from "./merge-queue.js";
export type { MergeQueueEntry, MergeResult } from "./merge-queue.js";

export { MergeExecutor } from "./merge-executor.js";
export type { MergeExecutorConfig } from "./merge-executor.js";

export { reconcile, Reconciler } from "./reconciler.js";
export type { ReconcilerConfig, ReconcilerResult } from "./reconciler.js";

export {
	generateHandoffReport,
	saveHandoffReport,
	readHandoffReports,
} from "./handoff.js";
export type { HandoffMetrics, HandoffReport } from "./handoff.js";

export { finalize } from "./finalization.js";
export type { FinalizationConfig, FinalizationResult } from "./finalization.js";
