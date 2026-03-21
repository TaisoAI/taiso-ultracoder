import * as fs from "node:fs";
import { appendJsonl } from "@ultracoder/core";
import { computeConfidence } from "./confidence.js";
import type { ExperimentIteration, ExperimentState } from "./types.js";

/**
 * Write experiment progress to .ultracoder/progress.md in the workspace.
 * This file is read by the agent on each iteration for context.
 */
export async function writeExperimentProgress(
	workspacePath: string,
	state: ExperimentState,
): Promise<void> {
	const dir = `${workspacePath}/.ultracoder`;
	await fs.promises.mkdir(dir, { recursive: true });

	const md = formatProgressMarkdown(state);
	await fs.promises.writeFile(`${dir}/progress.md`, md, "utf-8");
}

/**
 * Append an iteration record to .ultracoder/experiment-history.jsonl
 */
export async function appendExperimentHistory(
	workspacePath: string,
	iteration: ExperimentIteration,
): Promise<void> {
	const historyPath = `${workspacePath}/.ultracoder/experiment-history.jsonl`;
	await appendJsonl(historyPath, iteration);
}

function formatProgressMarkdown(state: ExperimentState): string {
	const lines: string[] = [];

	const bestDisplay = state.bestValue !== null ? String(state.bestValue) : "N/A";
	const baseline =
		state.history.length > 0 ? String(state.history[0].value) : "N/A";

	lines.push(`# Experiment: ${state.objective}`);
	lines.push(
		`Iteration: ${state.iteration} of ${state.termination.maxIterations} | Best: ${bestDisplay} (${state.metric.direction === "up" ? "higher is better" : "lower is better"}) | Baseline: ${baseline}`,
	);
	lines.push("");

	// Recent history table (last 10 iterations)
	const recent = state.history.slice(-10);
	if (recent.length > 0) {
		lines.push("## Recent History");
		lines.push("| Iter | Value | Delta | Kept | What was tried |");
		lines.push("|------|-------|-------|------|----------------|");
		for (const entry of recent) {
			const deltaStr =
				entry.delta >= 0 ? `+${entry.delta.toFixed(2)}` : entry.delta.toFixed(2);
			const desc = entry.description ?? "-";
			lines.push(
				`| ${entry.iteration} | ${entry.value} | ${deltaStr} | ${entry.kept ? "Yes" : "No"} | ${desc} |`,
			);
		}
		lines.push("");
	}

	// Confidence assessment (requires 3+ data points)
	if (state.history.length >= 3 && state.bestValue !== null) {
		const lastKept = [...state.history].reverse().find((h) => h.kept);
		const bestDelta = lastKept ? lastKept.delta : 0;
		const confidence = computeConfidence(state.history, bestDelta);
		if (confidence) {
			lines.push("## Confidence");
			lines.push(
				`Statistical confidence: **${confidence.level}** (score: ${confidence.score === Infinity ? "Inf" : confidence.score.toFixed(2)}, MAD: ${confidence.mad.toFixed(4)}, samples: ${confidence.sampleSize})`,
			);
			lines.push("");
		}
	}

	// Secondary metrics summary
	if (state.secondaryMetrics && state.secondaryMetrics.length > 0) {
		const lastEntry = state.history[state.history.length - 1];
		const secondaryValues = lastEntry?.secondaryValues;
		if (secondaryValues && Object.keys(secondaryValues).length > 0) {
			lines.push("## Secondary Metrics");
			lines.push("| Metric | Current | Baseline | Delta | Direction |");
			lines.push("|--------|---------|----------|-------|-----------|");
			for (const cfg of state.secondaryMetrics) {
				const current = secondaryValues[cfg.name];
				const baselineVal = state.secondaryBaselines?.[cfg.name];
				if (current !== undefined) {
					const baselineStr = baselineVal !== undefined ? String(baselineVal) : "N/A";
					const deltaStr =
						baselineVal !== undefined
							? formatDelta(current - baselineVal)
							: "N/A";
					const dirStr = cfg.direction === "up" ? "higher is better" : cfg.direction === "down" ? "lower is better" : "-";
					lines.push(
						`| ${cfg.name} | ${current} | ${baselineStr} | ${deltaStr} | ${dirStr} |`,
					);
				}
			}
			lines.push("");
		}
	}

	// Instructions for the agent
	lines.push("## Instructions");
	lines.push(
		`Make ONE targeted change to improve the metric "${state.metric.name}" (${state.metric.direction === "up" ? "higher" : "lower"} is better).`,
	);
	lines.push(
		"Focus on a single approach per iteration. Do NOT make unrelated changes.",
	);
	if (state.metric.command) {
		lines.push(
			`You can verify your changes by running: \`${state.metric.command}\``,
		);
	}
	lines.push("");

	return lines.join("\n");
}

function formatDelta(delta: number): string {
	return delta >= 0 ? `+${delta.toFixed(2)}` : delta.toFixed(2);
}

/**
 * Generate a PR body summarizing the experiment results.
 */
export function generateExperimentPRBody(state: ExperimentState): string {
	const lines: string[] = [];

	lines.push("## Experiment Summary");
	lines.push("");
	lines.push(`**Objective:** ${state.objective}`);
	lines.push(`**Metric:** ${state.metric.name} (${state.metric.direction})`);
	lines.push(`**Iterations:** ${state.iteration}`);
	lines.push(`**Best Value:** ${state.bestValue}`);
	lines.push(
		`**Termination:** ${state.terminationReason ?? "manual"}`,
	);
	lines.push("");

	// Full history table
	if (state.history.length > 0) {
		lines.push("### Iteration History");
		lines.push("| Iter | Value | Delta | Kept | Description |");
		lines.push("|------|-------|-------|------|-------------|");
		for (const entry of state.history) {
			const deltaStr = formatDelta(entry.delta);
			const desc = entry.description ?? "-";
			lines.push(
				`| ${entry.iteration} | ${entry.value} | ${deltaStr} | ${entry.kept ? "Yes" : "No"} | ${desc} |`,
			);
		}
		lines.push("");
	}

	// Secondary metrics final state
	if (state.secondaryMetrics && state.secondaryMetrics.length > 0 && state.secondaryBaselines) {
		const lastEntry = state.history[state.history.length - 1];
		const secondaryValues = lastEntry?.secondaryValues;
		if (secondaryValues && Object.keys(secondaryValues).length > 0) {
			lines.push("### Secondary Metrics");
			lines.push("| Metric | Final | Baseline | Delta | Direction |");
			lines.push("|--------|-------|----------|-------|-----------|");
			for (const cfg of state.secondaryMetrics) {
				const final = secondaryValues[cfg.name];
				const baselineVal = state.secondaryBaselines[cfg.name];
				if (final !== undefined) {
					const baselineStr = baselineVal !== undefined ? String(baselineVal) : "N/A";
					const deltaStr = baselineVal !== undefined ? formatDelta(final - baselineVal) : "N/A";
					const dirStr = cfg.direction ?? "-";
					lines.push(
						`| ${cfg.name} | ${final} | ${baselineStr} | ${deltaStr} | ${dirStr} |`,
					);
				}
			}
			lines.push("");
		}
	}

	return lines.join("\n");
}
