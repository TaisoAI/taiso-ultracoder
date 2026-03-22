import type { Logger, ReviewVerdict } from "@ultracoder/core";
import { type GateConfig, type GatesResult, runGates } from "./gates.js";
import { type ReviewerConfig, reviewDiff } from "./reviewer.js";
import {
	type ToolPolicyConfig,
	type ToolPolicyDecision,
	evaluateToolPolicy,
} from "./tool-policy.js";
import {
	type VeracityConfig,
	type VeracityFinding,
	checkVeracity,
	checkVeracityFilesystem,
} from "./veracity.js";

export interface QualityPipelineConfig {
	veracity: VeracityConfig;
	toolPolicy: ToolPolicyConfig;
	gates: GateConfig;
	reviewer: ReviewerConfig;
}

export interface QualityPipelineResult {
	passed: boolean;
	veracity: VeracityFinding[];
	filesystemVeracity: VeracityFinding[];
	toolPolicyDecisions: ToolPolicyDecision[];
	gates?: GatesResult;
	review?: ReviewVerdict | null;
	errors: string[];
}

/**
 * Composable quality pipeline.
 * Runs configured quality stages in sequence and aggregates results.
 */
export async function runQualityPipeline(
	opts: {
		content?: string;
		projectPath: string;
		diff?: string;
		task?: string;
		sessionId?: string;
		/** Tool invocations to evaluate against policy. */
		toolCalls?: string[];
		/** Files the agent claims to have changed. */
		claimedFiles?: string[];
	},
	config: QualityPipelineConfig,
	logger: Logger,
): Promise<QualityPipelineResult> {
	const errors: string[] = [];
	let veracity: VeracityFinding[] = [];
	let filesystemVeracity: VeracityFinding[] = [];
	const toolPolicyDecisions: ToolPolicyDecision[] = [];
	let gates: GatesResult | undefined;
	let review: ReviewVerdict | null | undefined;

	// Stage 1: Veracity checking (regex/LLM)
	if (opts.content) {
		try {
			veracity = await checkVeracity(opts.content, config.veracity, logger, {
				task: opts.task,
				workspacePath: opts.projectPath,
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			errors.push(`Veracity check failed: ${message}`);
		}
	}

	// Stage 1b: Filesystem veracity (git diff cross-check)
	try {
		filesystemVeracity = await checkVeracityFilesystem(opts.projectPath, opts.claimedFiles);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		errors.push(`Filesystem veracity check failed: ${message}`);
	}

	// Stage 2: Tool policy evaluation
	if (opts.toolCalls) {
		for (const tool of opts.toolCalls) {
			const decision = evaluateToolPolicy(tool, config.toolPolicy);
			toolPolicyDecisions.push(decision);
			if (!decision.allowed) {
				logger.warn(`Tool blocked by policy: ${tool}`, { reason: decision.reason });
			}
		}
	}

	// Stage 3: Quality gates
	try {
		gates = await runGates(opts.projectPath, config.gates, logger);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		errors.push(`Quality gates failed: ${message}`);
	}

	// Stage 4: Reviewer
	if (opts.diff && opts.task && opts.sessionId) {
		try {
			review = await reviewDiff(
				{ diff: opts.diff, task: opts.task, sessionId: opts.sessionId },
				config.reviewer,
				logger,
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			errors.push(`Reviewer failed: ${message}`);
		}
	}

	const veracityPassed = !veracity.some((f) => f.severity === "error");
	const fsVeracityPassed = !filesystemVeracity.some((f) => f.severity === "error");
	// Tools requiring approval are not failures — they're paused, not blocked
	const toolPolicyPassed = toolPolicyDecisions.every((d) => d.allowed || d.requiresApproval);
	const gatesPassed = gates?.passed ?? true;
	const reviewPassed = !review || review.decision !== "request_changes";

	return {
		passed:
			veracityPassed &&
			fsVeracityPassed &&
			toolPolicyPassed &&
			gatesPassed &&
			reviewPassed &&
			errors.length === 0,
		veracity,
		filesystemVeracity,
		toolPolicyDecisions,
		gates,
		review,
		errors,
	};
}
