import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { Logger, ReviewOpts, ReviewVerdict } from "@ultracoder/core";

const execFile = promisify(execFileCb);

export interface ReviewerConfig {
	enabled: boolean;
	model?: string;
	/** Path to the agent CLI binary. Default: "claude" */
	agentPath?: string;
	/** Timeout in ms. Default: 120000 (2 min) */
	timeoutMs?: number;
}

const REVIEW_PROMPT_TEMPLATE = `You are a code reviewer. Review the following diff for a task and provide a structured verdict.

Task: {task}

Diff:
\`\`\`
{diff}
\`\`\`

Respond with EXACTLY one of these verdicts on the first line:
- APPROVE: if the changes look correct and complete
- REQUEST_CHANGES: if there are issues that must be fixed
- COMMENT: if there are suggestions but nothing blocking

Then provide a brief summary (1-3 sentences).

Then list any specific file comments in this format (one per line):
COMMENT file.ts:42 description of the issue

Example response:
APPROVE
Changes look good. The refactoring improves readability.
COMMENT src/utils.ts:15 Consider adding a null check here.`;

const VERDICT_MAP: Record<string, ReviewVerdict["decision"]> = {
	APPROVE: "approve",
	REQUEST_CHANGES: "request_changes",
	COMMENT: "comment",
};

/**
 * Parse the raw text output from the review agent into a structured ReviewVerdict.
 */
export function parseReviewOutput(output: string): ReviewVerdict {
	const lines = output.trim().split("\n");

	// Extract verdict from first line
	let decision: ReviewVerdict["decision"] = "comment";
	const firstLine = lines[0]?.trim() ?? "";
	for (const [key, value] of Object.entries(VERDICT_MAP)) {
		if (firstLine.startsWith(key)) {
			decision = value;
			break;
		}
	}

	// Extract comments (lines starting with "COMMENT file:line")
	const comments: ReviewVerdict["comments"] = [];
	const summaryLines: string[] = [];

	for (let i = 1; i < lines.length; i++) {
		const line = lines[i];
		const commentMatch = line.match(/^COMMENT\s+(\S+):(\d+)\s+(.+)$/);
		if (commentMatch) {
			comments.push({
				file: commentMatch[1],
				line: Number.parseInt(commentMatch[2], 10),
				body: commentMatch[3],
			});
		} else {
			summaryLines.push(line);
		}
	}

	const summary = summaryLines.join("\n").trim() || "No summary provided";

	return { decision, summary, comments };
}

/**
 * Reviewer agent: spawns a short-lived agent process to review a diff
 * and returns a structured verdict.
 */
export async function reviewDiff(
	opts: ReviewOpts,
	config: ReviewerConfig,
	logger: Logger,
): Promise<ReviewVerdict | null> {
	if (!config.enabled) return null;

	const agentPath = config.agentPath ?? "claude";
	const timeoutMs = config.timeoutMs ?? 120_000;

	logger.info("Running reviewer agent", {
		sessionId: opts.sessionId,
		model: config.model ?? "default",
		diffLength: opts.diff.length,
	});

	const prompt = REVIEW_PROMPT_TEMPLATE.replace("{task}", opts.task).replace("{diff}", opts.diff);

	const args = ["-p", prompt, "--output-format", "text"];
	if (config.model) {
		args.push("--model", config.model);
	}

	try {
		const { stdout } = await execFile(agentPath, args, {
			timeout: timeoutMs,
			maxBuffer: 10 * 1024 * 1024,
		});
		return parseReviewOutput(stdout);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : "Unknown reviewer error";
		logger.warn("Reviewer agent failed, returning non-blocking comment", {
			error: message,
			sessionId: opts.sessionId,
		});
		return {
			decision: "comment",
			summary: `Reviewer error: ${message}`,
			comments: [],
		};
	}
}
