import type { Deps, Session } from "@ultracoder/core";
import type { ExperimentIteration, ExperimentState } from "./types.js";
import { appendExperimentHistory, generateExperimentPRBody, writeExperimentProgress } from "./context-writer.js";
import { evaluate } from "./evaluator.js";
import { commitIteration, discardChanges } from "./git-ops.js";
import { measureMetric, runSecondaryMetrics } from "./metric-runner.js";
import { checkTermination } from "./termination.js";

/**
 * Check if a session is an active experiment session.
 */
export function isExperimentSession(session: Session): boolean {
	const exp = session.metadata.experiment;
	return (
		exp !== null &&
		typeof exp === "object" &&
		(exp as ExperimentState).enabled === true &&
		(exp as ExperimentState).status === "running"
	);
}

/**
 * ExperimentRunner: orchestrates the measure → evaluate → keep/discard → re-spawn cycle.
 *
 * Called by the worker when an experiment session's agent completes an iteration.
 * Returns true if the experiment should continue (stay in "working"),
 * false if terminated (transition to "pr_open").
 */
export class ExperimentRunner {
	private readonly deps: Deps;
	private readonly logger: ReturnType<Deps["logger"]["child"]>;

	constructor(deps: Deps) {
		this.deps = deps;
		this.logger = deps.logger.child({ component: "experiment-runner" });
	}

	/**
	 * Handle an iteration completion for an experiment session.
	 *
	 * @returns `true` if experiment continues (session stays "working"),
	 *          `false` if terminated (caller should transition to "pr_open").
	 */
	async handleIterationComplete(session: Session): Promise<{
		continues: boolean;
		prBody?: string;
	}> {
		const state = session.metadata.experiment as ExperimentState;
		const cwd = session.workspacePath;

		this.logger.info("Experiment iteration complete", {
			sessionId: session.id,
			iteration: state.iteration + 1,
		});

		// 1. Measure
		let value: number;
		try {
			const result = await measureMetric(state.metric, cwd);
			value = result.value;
			this.logger.info("Metric measured", {
				sessionId: session.id,
				metric: state.metric.name,
				value,
			});
		} catch (err) {
			this.logger.error("Measurement failed — discarding iteration", {
				sessionId: session.id,
				error: String(err),
			});
			await discardChanges(cwd);

			const failedIteration: ExperimentIteration = {
				iteration: state.iteration + 1,
				value: state.bestValue ?? 0,
				delta: 0,
				kept: false,
				timestamp: new Date().toISOString(),
				description: `Measurement failed: ${String(err)}`,
			};
			state.history.push(failedIteration);
			state.iteration += 1;
			await appendExperimentHistory(cwd, failedIteration);

			return this.checkAndContinue(session, state);
		}

		// 1b. Measure secondary metrics (failures warn but don't block)
		let secondaryValues: Record<string, number> | undefined;
		if (state.secondaryMetrics && state.secondaryMetrics.length > 0) {
			secondaryValues = await runSecondaryMetrics(
				state.secondaryMetrics,
				cwd,
				(name, error) => {
					this.logger.warn("Secondary metric failed", {
						sessionId: session.id,
						metric: name,
						error: String(error),
					});
				},
			);

			// Record baselines on first successful measurement
			if (!state.secondaryBaselines) {
				state.secondaryBaselines = { ...secondaryValues };
			}

			this.logger.info("Secondary metrics measured", {
				sessionId: session.id,
				secondaryValues,
			});
		}

		// 2. Evaluate (pass history for confidence scoring)
		const evaluation = evaluate(value, state.bestValue, state.metric, state.history);
		this.logger.info("Evaluation result", {
			sessionId: session.id,
			kept: evaluation.kept,
			delta: evaluation.delta,
			reason: evaluation.reason,
			confidence: evaluation.confidence,
		});

		// 3. Keep or discard
		let commitSha: string | undefined;
		if (evaluation.kept) {
			commitSha = await commitIteration(
				cwd,
				state.iteration + 1,
				state.metric.name,
				value,
			);
			state.bestValue = value;
			state.bestCommit = commitSha;
		} else {
			await discardChanges(cwd);
		}

		// 4. Record iteration
		const iterationRecord: ExperimentIteration = {
			iteration: state.iteration + 1,
			value,
			delta: evaluation.delta,
			kept: evaluation.kept,
			commitSha,
			timestamp: new Date().toISOString(),
			secondaryValues,
		};
		state.history.push(iterationRecord);
		state.iteration += 1;
		await appendExperimentHistory(cwd, iterationRecord);

		// 5. Check termination & continue
		return this.checkAndContinue(session, state);
	}

	private async checkAndContinue(
		session: Session,
		state: ExperimentState,
	): Promise<{ continues: boolean; prBody?: string }> {
		// Read current cost from metadata
		const currentCost =
			typeof session.metadata.costUsd === "number"
				? session.metadata.costUsd
				: undefined;

		const termResult = checkTermination(state, currentCost);

		if (termResult.terminated) {
			state.status = "terminated";
			state.terminationReason = termResult.reason;

			this.logger.info("Experiment terminated", {
				sessionId: session.id,
				reason: termResult.reason,
				iterations: state.iteration,
				bestValue: state.bestValue,
			});

			// Update session metadata with final state
			await this.deps.sessions.update(session.id, {
				metadata: { ...session.metadata, experiment: state },
			});

			const prBody = generateExperimentPRBody(state);
			return { continues: false, prBody };
		}

		// Continue: write progress and update metadata
		await writeExperimentProgress(session.workspacePath, state);
		await this.deps.sessions.update(session.id, {
			metadata: { ...session.metadata, experiment: state },
		});

		this.logger.info("Experiment continuing", {
			sessionId: session.id,
			iteration: state.iteration,
			bestValue: state.bestValue,
		});

		return { continues: true };
	}
}
