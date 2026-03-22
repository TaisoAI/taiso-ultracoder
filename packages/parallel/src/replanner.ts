import type { Logger } from "@ultracoder/core";
import type { HandoffReport } from "./handoff.js";
import type { DecomposerConfig, DecompositionResult } from "./decomposer.js";
import { decomposeTask } from "./decomposer.js";

export interface ReplanDecision {
	shouldReplan: boolean;
	reason: string;
}

export interface ReplanContext {
	completedSummaries: string[];
	failedSummaries: string[];
	remainingWork: string;
}

export interface ReplanResult {
	newTasks: DecompositionResult;
	context: ReplanContext;
}

/**
 * Determine whether re-planning is needed based on handoff reports.
 *
 * Returns `shouldReplan: true` when any handoff failed, partially completed,
 * or completed with concerns that need attention.
 */
export function shouldReplan(handoffs: HandoffReport[]): ReplanDecision {
	const failed = handoffs.filter((h) => h.status === "failed");
	if (failed.length > 0) {
		const ids = failed.map((h) => h.sessionId).join(", ");
		return {
			shouldReplan: true,
			reason: `${failed.length} task(s) failed: ${ids}`,
		};
	}

	const partial = handoffs.filter((h) => h.status === "partial");
	if (partial.length > 0) {
		const ids = partial.map((h) => h.sessionId).join(", ");
		return {
			shouldReplan: true,
			reason: `${partial.length} task(s) partially completed: ${ids}`,
		};
	}

	const withConcerns = handoffs.filter(
		(h) => h.status === "completed" && h.concerns.length > 0,
	);
	if (withConcerns.length > 0) {
		const ids = withConcerns.map((h) => h.sessionId).join(", ");
		return {
			shouldReplan: true,
			reason: `${withConcerns.length} completed task(s) raised concerns: ${ids}`,
		};
	}

	return { shouldReplan: false, reason: "All tasks completed successfully" };
}

/**
 * Build an enriched prompt that incorporates completed and failed work,
 * then call the decomposer to plan the remaining work.
 */
export async function replan(
	originalTask: string,
	completedHandoffs: HandoffReport[],
	failedHandoffs: HandoffReport[],
	projectContext: { files: string[]; description?: string },
	logger: Logger,
	config?: DecomposerConfig,
): Promise<ReplanResult> {
	const completedSummaries = completedHandoffs.map(
		(h) => `- ${h.task}: ${h.summary}`,
	);
	const failedSummaries = failedHandoffs.map(
		(h) => `- ${h.task}: FAILED - ${h.summary}`,
	);

	const enrichedPrompt = [
		`Original task: ${originalTask}`,
		"",
		"Completed work:",
		...(completedSummaries.length > 0
			? completedSummaries
			: ["- (none)"]),
		"",
		"Failed work:",
		...(failedSummaries.length > 0 ? failedSummaries : ["- (none)"]),
		"",
		"Based on the completed and failed work above, decompose the remaining work needed to finish the original task. Focus on what failed and needs to be retried or done differently.",
	].join("\n");

	logger.info("Re-planning task", {
		originalTask,
		completedCount: completedHandoffs.length,
		failedCount: failedHandoffs.length,
	});

	const newTasks = await decomposeTask(
		enrichedPrompt,
		projectContext,
		logger,
		config,
	);

	return {
		newTasks,
		context: {
			completedSummaries: completedHandoffs.map(
				(h) => `${h.task}: ${h.summary}`,
			),
			failedSummaries: failedHandoffs.map(
				(h) => `${h.task}: FAILED - ${h.summary}`,
			),
			remainingWork: enrichedPrompt,
		},
	};
}
