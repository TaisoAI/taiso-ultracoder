import type { ExperimentIteration } from "./types.js";

export interface ConfidenceResult {
	score: number;
	level: "high" | "medium" | "low";
	mad: number;
	sampleSize: number;
}

/**
 * Compute the Median Absolute Deviation of a set of values.
 *
 * MAD = median(|x_i - median(x)|)
 */
export function computeMAD(values: number[]): number {
	if (values.length === 0) return 0;

	const sorted = [...values].sort((a, b) => a - b);
	const median = getMedian(sorted);

	const deviations = values.map((v) => Math.abs(v - median));
	const sortedDeviations = [...deviations].sort((a, b) => a - b);

	return getMedian(sortedDeviations);
}

/**
 * Compute statistical confidence for an experiment's best delta using MAD-based scoring.
 *
 * score = |bestDelta| / MAD
 *   - high:   score >= 2.0 (delta is well outside noise)
 *   - medium: score >= 1.0 (delta exceeds noise)
 *   - low:    score <  1.0 (delta is within noise)
 *
 * Returns null if fewer than 3 data points (insufficient for noise estimation).
 */
export function computeConfidence(
	history: ExperimentIteration[],
	bestDelta: number,
): ConfidenceResult | null {
	if (history.length < 3) return null;

	const values = history.map((h) => h.value);
	const mad = computeMAD(values);

	// If MAD is 0, all values are identical at the median — any nonzero delta
	// is infinitely significant. Use Infinity so callers get "high".
	const score = mad === 0 ? (bestDelta === 0 ? 0 : Infinity) : Math.abs(bestDelta) / mad;

	const level: ConfidenceResult["level"] =
		score >= 2.0 ? "high" : score >= 1.0 ? "medium" : "low";

	return { score, level, mad, sampleSize: values.length };
}

function getMedian(sorted: number[]): number {
	const mid = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 1) return sorted[mid];
	return (sorted[mid - 1] + sorted[mid]) / 2;
}
