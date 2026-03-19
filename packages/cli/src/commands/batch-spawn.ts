import * as fs from "node:fs";
import type { AgentPlugin, RuntimePlugin, Session, WorkspacePlugin } from "@ultracoder/core";
import { Command } from "commander";
import { buildContext } from "../context.js";

export function batchSpawnCommand(): Command {
	return new Command("batch-spawn")
		.description("Spawn sessions for multiple tasks from a file (one task per line)")
		.argument("<file>", "Path to file with one task per line")
		.option("-a, --agent <type>", "Agent type (claude-code, codex)", "claude-code")
		.option("-m, --max-concurrent <n>", "Maximum concurrent spawns", "5")
		.action(async (file: string, opts: { agent: string; maxConcurrent: string }) => {
			// Read tasks from file
			let content: string;
			try {
				content = await fs.promises.readFile(file, "utf-8");
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error(`Failed to read file '${file}': ${message}`);
				process.exit(1);
			}

			const tasks = content
				.split("\n")
				.map((line) => line.trim())
				.filter((line) => line.length > 0 && !line.startsWith("#"));

			if (tasks.length === 0) {
				console.error("No tasks found in file");
				process.exit(1);
			}

			const maxConcurrent = Number.parseInt(opts.maxConcurrent, 10);
			if (Number.isNaN(maxConcurrent) || maxConcurrent < 1) {
				console.error(`Invalid --max-concurrent value: ${opts.maxConcurrent}`);
				process.exit(1);
			}

			const ctx = await buildContext();
			const results: Array<{ task: string; session?: Session; error?: string }> = [];

			// Process tasks in batches
			for (let i = 0; i < tasks.length; i += maxConcurrent) {
				const batch = tasks.slice(i, i + maxConcurrent);
				const batchResults = await Promise.allSettled(
					batch.map(async (task) => {
						const branch = `uc/${task
							.toLowerCase()
							.replace(/[^a-z0-9]+/g, "-")
							.slice(0, 40)}`;

						const session = await ctx.sessions.create({
							projectId: ctx.config.projectId,
							task,
							agentType: opts.agent,
							workspacePath: ctx.config.rootPath,
							branch,
							metadata: {},
						});

						// --- Workspace ---
						const workspace = ctx.plugins.get("workspace") as WorkspacePlugin | undefined;
						let workspacePath = ctx.config.rootPath;

						if (workspace) {
							const workspaceInfo = await workspace.create({
								projectPath: ctx.config.rootPath,
								branch,
								sessionId: session.id,
							});
							workspacePath = workspaceInfo.path;
							await ctx.sessions.update(session.id, { workspacePath: workspaceInfo.path });
						}

						// --- Agent command ---
						const agent = ctx.plugins.get("agent") as AgentPlugin | undefined;
						if (!agent) {
							return session;
						}

						const cmd = agent.buildCommand({
							task,
							workspacePath,
							config: ctx.config.session.agent,
						});

						// --- Runtime ---
						const runtime = ctx.plugins.get("runtime") as RuntimePlugin | undefined;
						if (!runtime) {
							return session;
						}

						const handle = await runtime.spawn({
							command: cmd.command,
							args: cmd.args,
							cwd: workspacePath,
							name: `uc-${session.id}`,
						});

						return await ctx.sessions.update(session.id, {
							status: "working",
							runtimeId: handle.id,
							pid: handle.pid,
						});
					}),
				);

				for (let j = 0; j < batchResults.length; j++) {
					const result = batchResults[j];
					const task = batch[j];
					if (result.status === "fulfilled") {
						results.push({ task, session: result.value });
					} else {
						results.push({
							task,
							error: result.reason instanceof Error ? result.reason.message : String(result.reason),
						});
					}
				}
			}

			// Print results table
			console.log("");
			console.log("Session ID  Status     Task");
			console.log(`----------  ---------  ${"-".repeat(40)}`);
			for (const r of results) {
				if (r.session) {
					const id = r.session.id.padEnd(10);
					const status = r.session.status.padEnd(9);
					console.log(`${id}  ${status}  ${r.task}`);
				} else {
					const id = "ERROR".padEnd(10);
					const status = "failed".padEnd(9);
					console.log(`${id}  ${status}  ${r.task} (${r.error})`);
				}
			}
			console.log("");
			console.log(`Spawned ${results.filter((r) => r.session).length}/${results.length} sessions`);
		});
}
