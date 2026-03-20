import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { Logger } from "@ultracoder/core";
import type { AgentAssessment } from "./types.js";

const execFile = promisify(execFileCb);

export interface AssessorConfig {
	agentPath: string;
	timeoutMs: number;
}

const ASSESSMENT_PROMPT = `You are a senior engineer assessing a GitHub issue for automated resolution.

## Issue #{id}: {title}
{body}

## Your Task
Analyze this issue and provide a structured assessment:
1. Root cause analysis — what is likely causing this?
2. Severity classification (critical/high/medium/low)
3. Effort estimate (trivial/small/medium/large)
4. Proposed fix approach — what specific changes would resolve this?
5. Related files — which files need to be modified?
6. Confidence level (0-1) — how confident are you in this assessment?

Respond in this exact JSON format:
{ "severity": "...", "effort": "...", "rootCause": "...", "proposedFix": "...", "relatedFiles": [...], "confidence": 0.8 }`;

function buildPrompt(issueId: string, title: string, body: string): string {
	return ASSESSMENT_PROMPT.replace("{id}", issueId)
		.replace("{title}", title)
		.replace("{body}", body);
}

const VALID_SEVERITIES = new Set(["critical", "high", "medium", "low"]);
const VALID_EFFORTS = new Set(["trivial", "small", "medium", "large"]);

/**
 * Parse assessment JSON from agent output that may contain prose around the JSON.
 */
export function parseAssessmentOutput(output: string): Partial<AgentAssessment> | null {
	// Try fenced code block first
	const fencedMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
	const candidate = fencedMatch ? fencedMatch[1].trim() : output.trim();

	const jsonMatch = candidate.match(/\{[\s\S]*\}/);
	if (!jsonMatch) return null;

	try {
		const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

		const severity = parsed.severity;
		const effort = parsed.effort;
		if (
			typeof severity !== "string" ||
			typeof effort !== "string" ||
			typeof parsed.rootCause !== "string" ||
			typeof parsed.proposedFix !== "string"
		) {
			return null;
		}

		// Validate enum values
		const normalizedSeverity = severity.toLowerCase();
		const normalizedEffort = effort.toLowerCase();
		if (!VALID_SEVERITIES.has(normalizedSeverity) || !VALID_EFFORTS.has(normalizedEffort)) {
			return null;
		}

		const confidence = typeof parsed.confidence === "number"
			? Math.max(0, Math.min(1, parsed.confidence))
			: 0.5;

		return {
			severity: normalizedSeverity as AgentAssessment["severity"],
			effort: normalizedEffort as AgentAssessment["effort"],
			rootCause: parsed.rootCause as string,
			proposedFix: parsed.proposedFix as string,
			relatedFiles: Array.isArray(parsed.relatedFiles)
				? (parsed.relatedFiles as unknown[]).map(String)
				: [],
			confidence,
		};
	} catch {
		return null;
	}
}

/**
 * Run a single agent assessment against a GitHub issue.
 */
export async function runAssessment(
	agentName: string,
	issueId: string,
	title: string,
	body: string,
	config: AssessorConfig,
	logger: Logger,
): Promise<AgentAssessment> {
	const log = logger.child({ component: "assessor", agent: agentName, issueId });
	const prompt = buildPrompt(issueId, title, body);

	log.info("Running assessment");

	try {
		const { stdout } = await execFile(
			config.agentPath,
			["-p", prompt, "--output-format", "text"],
			{ timeout: config.timeoutMs, maxBuffer: 10 * 1024 * 1024 },
		);

		const parsed = parseAssessmentOutput(stdout);
		if (!parsed) {
			log.warn("Could not parse assessment output, using defaults");
			return {
				agent: agentName,
				severity: "medium",
				effort: "medium",
				rootCause: "Could not determine — agent output was not parseable",
				proposedFix: stdout.slice(0, 2000),
				relatedFiles: [],
				confidence: 0.1,
				completedAt: new Date().toISOString(),
			};
		}

		return {
			agent: agentName,
			severity: parsed.severity!,
			effort: parsed.effort!,
			rootCause: parsed.rootCause!,
			proposedFix: parsed.proposedFix!,
			relatedFiles: parsed.relatedFiles!,
			confidence: parsed.confidence!,
			completedAt: new Date().toISOString(),
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log.error("Assessment failed", { error: message });
		throw new Error(`Assessment by ${agentName} failed: ${message}`);
	}
}
