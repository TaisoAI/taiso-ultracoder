import type { ExperimentState, TerminationCheckResult } from "./types.js";

/**
 * Check all termination criteria for an experiment.
 * Returns the first matching reason, or { terminated: false }.
 */
export function checkTermination(
	state: ExperimentState,
	currentCostUsd?: number,
): TerminationCheckResult {
	// 1. Max iterations reached
	if (state.iteration >= state.termination.maxIterations) {
		return {
			terminated: true,
			reason: `Max iterations reached (${state.termination.maxIterations})`,
		};
	}

	// 2. Target value reached
	if (state.metric.target !== undefined && state.bestValue !== null) {
		const targetMet =
			state.metric.direction === "up"
				? state.bestValue >= state.metric.target
				: state.bestValue <= state.metric.target;
		if (targetMet) {
			return {
				terminated: true,
				reason: `Target reached: ${state.bestValue} ${state.metric.direction === "up" ? ">=" : "<="} ${state.metric.target}`,
			};
		}
	}

	// 3. No improvement streak
	if (state.history.length > 0) {
		const recentHistory = state.history.slice(-state.termination.maxNoImprovement);
		if (
			recentHistory.length >= state.termination.maxNoImprovement &&
			recentHistory.every((h) => !h.kept)
		) {
			return {
				terminated: true,
				reason: `No improvement for ${state.termination.maxNoImprovement} consecutive iterations`,
			};
		}
	}

	// 4. Budget exceeded
	if (
		state.termination.maxCostUsd !== undefined &&
		currentCostUsd !== undefined &&
		currentCostUsd >= state.termination.maxCostUsd
	) {
		return {
			terminated: true,
			reason: `Budget exceeded: $${currentCostUsd.toFixed(2)} >= $${state.termination.maxCostUsd.toFixed(2)}`,
		};
	}

	return { terminated: false };
}
