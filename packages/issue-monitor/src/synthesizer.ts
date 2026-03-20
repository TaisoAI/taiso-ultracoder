import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { Logger } from "@ultracoder/core";
import type { AgentAssessment, IssueRecord } from "./types.js";

const execFile = promisify(execFileCb);

export interface SynthesizerConfig {
	agentPath: string;
	timeoutMs: number;
}

function formatAssessment(a: AgentAssessment): string {
	return `Agent: ${a.agent}
Severity: ${a.severity} | Effort: ${a.effort} | Confidence: ${a.confidence}
Root Cause: ${a.rootCause}
Proposed Fix: ${a.proposedFix}
Related Files: ${a.relatedFiles.join(", ") || "(none)"}`;
}

const SYNTHESIS_PROMPT = `You are an engineering lead reviewing independent assessments of a GitHub issue.

## Issue #{id}: {title}
{body}

## Assessment 1 (Claude Opus 4.6):
{claudeAssessment}

## Assessment 2 (Codex):
{codexAssessment}

## Your Task
Synthesize both assessments into a single resolution plan. Consider where they agree and disagree. Produce a clear, actionable task description that a coding agent can implement.

Include:
1. The agreed-upon root cause (or note disagreements)
2. The specific changes to make (files, functions, approach)
3. Any test changes needed
4. What NOT to change (scope boundaries)

Write the plan as a task description, not JSON. Be specific and actionable.`;

function buildPrompt(record: IssueRecord): string {
	const claudeText = record.assessments?.claude
		? formatAssessment(record.assessments.claude)
		: "(not available)";
	const codexText = record.assessments?.codex
		? formatAssessment(record.assessments.codex)
		: "(not available)";

	return SYNTHESIS_PROMPT.replace("{id}", record.issueId)
		.replace("{title}", record.title)
		.replace("{body}", record.body)
		.replace("{claudeAssessment}", claudeText)
		.replace("{codexAssessment}", codexText);
}

/**
 * Synthesize a resolution plan from dual assessments using an LLM call.
 */
export async function synthesizePlan(
	record: IssueRecord,
	config: SynthesizerConfig,
	logger: Logger,
): Promise<string> {
	const log = logger.child({ component: "synthesizer", issueId: record.issueId });
	const prompt = buildPrompt(record);

	log.info("Synthesizing resolution plan");

	try {
		const { stdout } = await execFile(
			config.agentPath,
			["-p", prompt, "--output-format", "text"],
			{ timeout: config.timeoutMs },
		);

		const plan = stdout.trim();
		if (!plan) {
			throw new Error("Empty synthesis output");
		}

		log.info("Synthesis complete", { planLength: plan.length });
		return plan;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log.error("Synthesis failed", { error: message });
		throw new Error(`Plan synthesis failed: ${message}`);
	}
}
