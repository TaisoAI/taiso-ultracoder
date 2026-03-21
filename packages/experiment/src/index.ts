// @ultracoder/experiment — experiment/optimization loop integration

export type {
	ExperimentState,
	ExperimentMode,
	MetricConfig,
	SecondaryMetricConfig,
	TerminationConfig,
	ExperimentIteration,
	MeasurementResult,
	EvaluationResult,
	TerminationCheckResult,
} from "./types.js";

export type { ConfidenceResult } from "./confidence.js";
export { computeMAD, computeConfidence } from "./confidence.js";
export { measureMetric, extractValue, runSecondaryMetrics } from "./metric-runner.js";
export { evaluate } from "./evaluator.js";
export { commitIteration, discardChanges, getCurrentCommit } from "./git-ops.js";
export {
	writeExperimentProgress,
	appendExperimentHistory,
	generateExperimentPRBody,
} from "./context-writer.js";
export { checkTermination } from "./termination.js";
export { ExperimentRunner, isExperimentSession } from "./runner.js";
export { ParallelExperimentRunner } from "./parallel-runner.js";
