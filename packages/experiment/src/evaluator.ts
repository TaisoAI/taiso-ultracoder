import type { ConfidenceResult } from "./confidence.js";
import { computeConfidence } from "./confidence.js";
import type { MetricConfig, EvaluationResult, ExperimentIteration } from "./types.js";

/**
 * Evaluate whether a measured value is an improvement over the current best.
 *
 * Rules:
 * - direction "up": higher is better, delta must be positive
 * - direction "down": lower is better, delta must be negative (improvement = reduction)
 * - minDelta: minimum absolute improvement required to count as "kept"
 * - First iteration (bestValue is null) is always kept
 *
 * When history has 3+ entries, also computes MAD-based confidence scoring.
 * Confidence is advisory only — it never overrides the keep/discard decision.
 */
export function evaluate(
	value: number,
	bestValue: number | null,
	config: MetricConfig,
	history?: ExperimentIteration[],
): EvaluationResult {
	// First measurement — always keep as baseline
	if (bestValue === null) {
		return {
			kept: true,
			delta: 0,
			reason: "First measurement — establishing baseline",
			confidence: null,
		};
	}

	const delta = value - bestValue;
	const improved = config.direction === "up" ? delta > 0 : delta < 0;
	const absDelta = Math.abs(delta);

	// Compute confidence if we have enough history
	const confidence = history ? computeConfidence(history, delta) : null;

	if (!improved) {
		return {
			kept: false,
			delta,
			reason: `No improvement: ${value} vs best ${bestValue} (direction: ${config.direction})`,
			confidence,
		};
	}

	if (config.minDelta !== undefined && absDelta < config.minDelta) {
		return {
			kept: false,
			delta,
			reason: `Improvement too small: |${absDelta.toFixed(4)}| < minDelta ${config.minDelta}`,
			confidence,
		};
	}

	return {
		kept: true,
		delta,
		reason: `Improved: ${bestValue} → ${value} (delta: ${delta > 0 ? "+" : ""}${delta.toFixed(4)})`,
		confidence,
	};
}
