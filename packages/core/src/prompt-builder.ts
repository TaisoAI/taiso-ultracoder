import { readFileSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";

// ─── Prompt Context ─────────────────────────────────────────────────
export interface PromptContext {
	task: string;
	projectId: string;
	rootPath: string;
	defaultBranch: string;
	branch: string;
	agentType: string;
	sessionId: string;
	agentRules?: string;
	agentRulesFile?: string;
	metadata?: Record<string, unknown>;
}

// ─── Build Prompt ───────────────────────────────────────────────────

/**
 * Compose a layered prompt that enriches a raw task string with
 * Ultracoder instructions, project context, optional user rules,
 * and the task itself.
 */
export function buildPrompt(ctx: PromptContext): string {
	const sections: string[] = [];

	// Layer 1: Ultracoder base instructions
	sections.push(buildBaseLayer(ctx));

	// Layer 2: Project context
	sections.push(buildProjectLayer(ctx));

	// Layer 3: User rules (optional)
	const rulesLayer = buildRulesLayer(ctx);
	if (rulesLayer) {
		sections.push(rulesLayer);
	}

	// Layer 4: Task
	sections.push(buildTaskLayer(ctx));

	return sections.join("\n\n");
}

// ─── Layer builders ─────────────────────────────────────────────────

function buildBaseLayer(ctx: PromptContext): string {
	const lines: string[] = [
		"## Ultracoder Instructions",
		"",
		`You are an Ultracoder agent (session ${ctx.sessionId}).`,
		"",
		"### Git Workflow",
		`- Work on branch \`${ctx.branch}\`.`,
		`- Base branch is \`${ctx.defaultBranch}\`.`,
		"- Create atomic commits with clear messages.",
		"- When done, open a pull request against the base branch.",
	];

	// PR practices — include "Fixes #N" when an issue is referenced
	const issueId = ctx.metadata?.issueId;
	if (issueId != null) {
		lines.push(
			`- Include \"Fixes #${issueId}\" in the PR description to auto-close the issue.`,
		);
	}

	// Experiment context
	const experiment = ctx.metadata?.experiment;
	if (experiment != null && typeof experiment === "object") {
		const exp = experiment as Record<string, unknown>;
		lines.push("");
		lines.push("### Experiment Mode");
		if (exp.objective) {
			lines.push(`- Objective: ${exp.objective}`);
		}
		if (exp.metric && typeof exp.metric === "object") {
			const metric = exp.metric as Record<string, unknown>;
			if (metric.name) lines.push(`- Metric: ${metric.name}`);
			if (metric.direction)
				lines.push(`- Direction: ${metric.direction}`);
			if (metric.target != null)
				lines.push(`- Target: ${metric.target}`);
		}
		lines.push(
			"- Iterate to improve the metric. Commit after each meaningful change.",
		);
	}

	return lines.join("\n");
}

function buildProjectLayer(ctx: PromptContext): string {
	return [
		"## Project Context",
		"",
		`- Project: ${ctx.projectId}`,
		`- Root path: ${ctx.rootPath}`,
		`- Default branch: ${ctx.defaultBranch}`,
		`- Working branch: ${ctx.branch}`,
	].join("\n");
}

function buildRulesLayer(ctx: PromptContext): string | null {
	// Inline rules take priority
	if (ctx.agentRules) {
		return ["## Agent Rules", "", ctx.agentRules].join("\n");
	}

	// File-based rules
	if (ctx.agentRulesFile) {
		try {
			// Resolve relative paths against rootPath so config like "rules/ts.md" works
			const filePath = isAbsolute(ctx.agentRulesFile)
				? ctx.agentRulesFile
				: resolve(ctx.rootPath, ctx.agentRulesFile);
			const content = readFileSync(filePath, "utf-8");
			return ["## Agent Rules", "", content.trimEnd()].join("\n");
		} catch {
			// Warn via console (best-effort — callers may also have a logger)
			console.warn(
				`[prompt-builder] Could not read agentRulesFile "${ctx.agentRulesFile}" — continuing without agent rules.`,
			);
			return null;
		}
	}

	return null;
}

function buildTaskLayer(ctx: PromptContext): string {
	return ["## Task", "", ctx.task].join("\n");
}
