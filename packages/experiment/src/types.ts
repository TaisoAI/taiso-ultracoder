/** Experiment state stored in session.metadata.experiment */
export interface ExperimentState {
	enabled: true;
	objective: string;
	metric: MetricConfig;
	termination: TerminationConfig;
	mode: ExperimentMode;
	parallelVariations: number;
	iteration: number;
	bestValue: number | null;
	bestCommit: string | null;
	history: ExperimentIteration[];
	status: "running" | "terminated";
	terminationReason?: string;
	secondaryMetrics?: SecondaryMetricConfig[];
	secondaryBaselines?: Record<string, number>;
}

export type ExperimentMode = "sequential" | "parallel" | "hybrid";

export interface SecondaryMetricConfig {
	name: string;
	command: string;
	/** JSONPath ($.path.to.field) or regex (/pattern with (capture)/) */
	extract: string;
	direction?: "up" | "down";
}

export interface MetricConfig {
	name: string;
	command: string;
	/** JSONPath ($.path.to.field) or regex (/pattern with (capture)/) */
	extract: string;
	direction: "up" | "down";
	target?: number;
	minDelta?: number;
}

export interface TerminationConfig {
	maxIterations: number;
	maxNoImprovement: number;
	maxCostUsd?: number;
}

export interface ExperimentIteration {
	iteration: number;
	value: number;
	delta: number;
	kept: boolean;
	commitSha?: string;
	timestamp: string;
	description?: string;
	secondaryValues?: Record<string, number>;
}

export interface MeasurementResult {
	value: number;
	raw: string;
}

export interface EvaluationResult {
	kept: boolean;
	delta: number;
	reason: string;
	confidence: import("./confidence.js").ConfidenceResult | null;
}

export interface TerminationCheckResult {
	terminated: boolean;
	reason?: string;
}
