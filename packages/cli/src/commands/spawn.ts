import { runSpawnPipeline } from "@ultracoder/core";
import type { ExperimentState, ExperimentMode } from "@ultracoder/experiment";
import { Command } from "commander";
import { buildContext } from "../context.js";

interface SpawnOpts {
	agent: string;
	branch?: string;
	experiment?: string;
	metric?: string;
	measure?: string;
	extract?: string;
	direction?: string;
	target?: string;
	maxIterations?: string;
	maxNoImprovement?: string;
	maxCost?: string;
	minDelta?: string;
	preset?: string;
	mode?: string;
	parallelVariations?: string;
}

export function spawnCommand(): Command {
	return new Command("spawn")
		.description("Spawn a new agent session")
		.argument("<task>", "Task description for the agent")
		.option("-a, --agent <type>", "Agent type (claude-code, codex)", "claude-code")
		.option("-b, --branch <name>", "Branch name")
		.option("-e, --experiment <objective>", "Run in experiment mode with the given objective")
		.option("--metric <name>", "Metric name for experiment tracking")
		.option("--measure <command>", "Command to measure the metric")
		.option("--extract <pattern>", "Extraction pattern (JSONPath or regex)")
		.option("--direction <dir>", "Optimization direction (up or down)")
		.option("--target <value>", "Target metric value for early termination")
		.option("--max-iterations <n>", "Maximum iterations", "20")
		.option("--max-no-improvement <n>", "Max consecutive iterations without improvement", "5")
		.option("--max-cost <usd>", "Maximum cost budget in USD")
		.option("--min-delta <value>", "Minimum improvement delta to count as progress")
		.option("--preset <name>", "Use a metric preset from config")
		.option("--mode <mode>", "Experiment mode: sequential, parallel, or hybrid", "sequential")
		.option("--parallel-variations <n>", "Number of parallel variations", "3")
		.action(async (task: string, opts: SpawnOpts) => {
			const ctx = await buildContext();
			const branch =
				opts.branch ??
				`uc/${task
					.toLowerCase()
					.replace(/[^a-z0-9]+/g, "-")
					.slice(0, 40)}`;

			if (!/^[a-zA-Z0-9][a-zA-Z0-9._\/-]*$/.test(branch)) {
				console.error(
					`Invalid branch name: '${branch}'. Must start with alphanumeric and contain only alphanumerics, dots, underscores, slashes, or hyphens.`,
				);
				process.exit(1);
			}

			// Build experiment metadata if --experiment is provided
			const metadata: Record<string, unknown> = {};
			if (opts.experiment) {
				const experimentState = buildExperimentState(opts, ctx.config);
				if (!experimentState) return; // buildExperimentState prints errors
				metadata.experiment = experimentState;
			}

			const session = await ctx.sessions.create({
				projectId: ctx.config.projectId,
				task: opts.experiment ? `[experiment] ${task}` : task,
				agentType: opts.agent,
				workspacePath: ctx.config.rootPath,
				branch,
				metadata,
			});

			console.log(`Session ${session.id} created (status: ${session.status})`);
			if (opts.experiment) {
				const exp = metadata.experiment as ExperimentState;
				console.log(`  Experiment: ${exp.objective}`);
				console.log(`  Metric:     ${exp.metric.name} (${exp.metric.direction})`);
				console.log(`  Mode:       ${exp.mode}`);
				console.log(`  Max iters:  ${exp.termination.maxIterations}`);
			}

			try {
				const result = await runSpawnPipeline({
					session,
					task,
					deps: ctx,
					logger: ctx.logger,
				});

				if (!result.runtimeHandle) {
					console.log(`  Task:   ${session.task}`);
					console.log(`  Agent:  ${session.agentType}`);
					console.log(`  Branch: ${session.branch}`);
					console.log("  Status: spawning (agent not started)");
					return;
				}

				const updated = await ctx.sessions.get(session.id);
				if (updated) {
					console.log(`  Task:      ${updated.task}`);
					console.log(`  Agent:     ${updated.agentType}`);
					console.log(`  Branch:    ${updated.branch}`);
					console.log(`  Workspace: ${updated.workspacePath}`);
					console.log(`  Runtime:   ${result.runtimeHandle.id}${result.runtimeHandle.pid ? ` (pid ${result.runtimeHandle.pid})` : ""}`);
					console.log(`  Status:    ${updated.status}`);
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error(message);
			}
		});
}

function parseFiniteNumber(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;
	const n = Number(value);
	return Number.isFinite(n) ? n : undefined;
}

function buildExperimentState(
	opts: SpawnOpts,
	config: { experiments?: { presets?: Record<string, { command: string; extract: string; direction: string }>; mode?: string; parallelVariations?: number; defaultMaxIterations?: number; defaultMaxNoImprovement?: number } },
): ExperimentState | null {
	let command: string | undefined;
	let extract: string | undefined;
	let direction: "up" | "down" | undefined;

	// Try preset first
	if (opts.preset) {
		const preset = config.experiments?.presets?.[opts.preset];
		if (!preset) {
			console.error(`Unknown experiment preset: "${opts.preset}". Available: ${Object.keys(config.experiments?.presets ?? {}).join(", ") || "(none)"}`);
			return null;
		}
		command = preset.command;
		extract = preset.extract;
		direction = preset.direction as "up" | "down";
	}

	// CLI flags override preset values
	if (opts.measure) command = opts.measure;
	if (opts.extract) extract = opts.extract;
	if (opts.direction) direction = opts.direction as "up" | "down";

	if (!command || !extract || !direction) {
		console.error("Experiment mode requires --measure, --extract, and --direction (or --preset).");
		return null;
	}

	if (direction !== "up" && direction !== "down") {
		console.error(`Invalid direction: "${direction}". Must be "up" or "down".`);
		return null;
	}

	const mode = (opts.mode ?? config.experiments?.mode ?? "sequential") as ExperimentMode;
	if (!["sequential", "parallel", "hybrid"].includes(mode)) {
		console.error(`Invalid mode: "${mode}". Must be sequential, parallel, or hybrid.`);
		return null;
	}

	return {
		enabled: true,
		objective: opts.experiment!,
		metric: {
			name: opts.metric ?? "metric",
			command,
			extract,
			direction,
			target: parseFiniteNumber(opts.target),
			minDelta: parseFiniteNumber(opts.minDelta),
		},
		termination: {
			maxIterations: parseFiniteNumber(opts.maxIterations) ?? config.experiments?.defaultMaxIterations ?? 20,
			maxNoImprovement: parseFiniteNumber(opts.maxNoImprovement) ?? config.experiments?.defaultMaxNoImprovement ?? 5,
			maxCostUsd: parseFiniteNumber(opts.maxCost),
		},
		mode,
		parallelVariations: parseFiniteNumber(opts.parallelVariations) ?? config.experiments?.parallelVariations ?? 3,
		iteration: 0,
		bestValue: null,
		bestCommit: null,
		history: [],
		status: "running",
	};
}
