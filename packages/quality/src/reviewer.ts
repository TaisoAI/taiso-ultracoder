import type { Logger, ReviewOpts, ReviewVerdict } from "@ultracoder/core";

export interface ReviewerConfig {
	enabled: boolean;
	model?: string;
}

/**
 * Reviewer agent: invokes a 2nd AI instance in read-only mode
 * to review diffs and provide structured verdicts.
 *
 * This is a placeholder — production implementation would call
 * the configured LLM with a review-specific system prompt.
 */
export async function reviewDiff(
	opts: ReviewOpts,
	config: ReviewerConfig,
	logger: Logger,
): Promise<ReviewVerdict | null> {
	if (!config.enabled) return null;

	logger.info("Running reviewer agent", {
		sessionId: opts.sessionId,
		model: config.model ?? "default",
		diffLength: opts.diff.length,
	});

	// Placeholder: In production, this sends the diff to a read-only
	// LLM instance with a structured review prompt
	return {
		decision: "comment",
		summary: "Automated review not yet implemented — manual review recommended",
		comments: [],
	};
}
