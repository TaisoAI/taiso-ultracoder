import type { Deps, Session } from "@ultracoder/core";
import type { ExperimentState } from "./types.js";
import { evaluate } from "./evaluator.js";
import { commitIteration, discardChanges } from "./git-ops.js";
import { measureMetric } from "./metric-runner.js";
import { appendExperimentHistory, writeExperimentProgress } from "./context-writer.js";
import { checkTermination } from "./termination.js";
import { generateExperimentPRBody } from "./context-writer.js";

interface VariationResult {
	sessionId: string;
	value: number;
	commitSha?: string;
	error?: string;
}

/**
 * ParallelExperimentRunner: spawns N variations, measures each, keeps the best.
 *
 * For parallel mode: always runs N variations per round.
 * For hybrid mode: triggered by the sequential runner after a no-improvement streak.
 */
export class ParallelExperimentRunner {
	private readonly deps: Deps;
	private readonly logger: ReturnType<Deps["logger"]["child"]>;

	constructor(deps: Deps) {
		this.deps = deps;
		this.logger = deps.logger.child({ component: "parallel-experiment-runner" });
	}

	/**
	 * Evaluate results from multiple parallel variations.
	 * Picks the best result, commits it to the main experiment branch,
	 * and discards the rest.
	 *
	 * @param session - The parent experiment session
	 * @param variations - Child sessions that ran in parallel
	 * @returns Whether the experiment should continue
	 */
	async evaluateVariations(
		session: Session,
		variations: Session[],
	): Promise<{ continues: boolean; prBody?: string }> {
		const state = session.metadata.experiment as ExperimentState;

		this.logger.info("Evaluating parallel variations", {
			sessionId: session.id,
			variationCount: variations.length,
		});

		// Measure each variation
		const results: VariationResult[] = [];
		for (const variation of variations) {
			try {
				const measurement = await measureMetric(
					state.metric,
					variation.workspacePath,
				);
				results.push({
					sessionId: variation.id,
					value: measurement.value,
				});
			} catch (err) {
				results.push({
					sessionId: variation.id,
					value: state.bestValue ?? 0,
					error: String(err),
				});
			}
		}

		// Find the best result
		const validResults = results.filter((r) => !r.error);
		if (validResults.length === 0) {
			this.logger.warn("All parallel variations failed measurement", {
				sessionId: session.id,
			});
			state.iteration += 1;
			state.history.push({
				iteration: state.iteration,
				value: state.bestValue ?? 0,
				delta: 0,
				kept: false,
				timestamp: new Date().toISOString(),
				description: "All parallel variations failed measurement",
			});

			return this.checkAndContinue(session, state);
		}

		// Sort by metric direction
		const sorted = [...validResults].sort((a, b) =>
			state.metric.direction === "up" ? b.value - a.value : a.value - b.value,
		);
		const best = sorted[0];

		// Evaluate the best against current best (pass history for confidence scoring)
		const evaluation = evaluate(best.value, state.bestValue, state.metric, state.history);

		if (evaluation.kept) {
			// Find the winning variation session
			const winner = variations.find((v) => v.id === best.sessionId);
			if (winner) {
				const commitSha = await commitIteration(
					winner.workspacePath,
					state.iteration + 1,
					state.metric.name,
					best.value,
					`Parallel winner from ${validResults.length} variations`,
				);
				state.bestValue = best.value;
				state.bestCommit = commitSha;
			}
		}

		// Discard all variation workspaces
		for (const variation of variations) {
			try {
				await discardChanges(variation.workspacePath);
			} catch {
				// Best effort cleanup
			}
		}

		// Record iteration
		state.iteration += 1;
		const iterationRecord = {
			iteration: state.iteration,
			value: best.value,
			delta: evaluation.delta,
			kept: evaluation.kept,
			timestamp: new Date().toISOString(),
			description: `Best of ${validResults.length} parallel variations`,
		};
		state.history.push(iterationRecord);
		await appendExperimentHistory(session.workspacePath, iterationRecord);

		return this.checkAndContinue(session, state);
	}

	/**
	 * Check if the experiment should switch from sequential to parallel (hybrid mode).
	 * Returns true if the no-improvement streak has reached the threshold.
	 */
	shouldBurstParallel(state: ExperimentState): boolean {
		if (state.mode !== "hybrid") return false;

		const recent = state.history.slice(-state.termination.maxNoImprovement);
		return (
			recent.length >= state.termination.maxNoImprovement &&
			recent.every((h) => !h.kept)
		);
	}

	private async checkAndContinue(
		session: Session,
		state: ExperimentState,
	): Promise<{ continues: boolean; prBody?: string }> {
		const currentCost =
			typeof session.metadata.costUsd === "number"
				? session.metadata.costUsd
				: undefined;

		const termResult = checkTermination(state, currentCost);

		if (termResult.terminated) {
			state.status = "terminated";
			state.terminationReason = termResult.reason;

			await this.deps.sessions.update(session.id, {
				metadata: { ...session.metadata, experiment: state },
			});

			const prBody = generateExperimentPRBody(state);
			return { continues: false, prBody };
		}

		await writeExperimentProgress(session.workspacePath, state);
		await this.deps.sessions.update(session.id, {
			metadata: { ...session.metadata, experiment: state },
		});

		return { continues: true };
	}
}
