import type { AgentPlugin, RuntimePlugin, WorkspacePlugin } from "@ultracoder/core";
import { Command } from "commander";
import { buildContext } from "../context.js";

export function spawnCommand(): Command {
	return new Command("spawn")
		.description("Spawn a new agent session")
		.argument("<task>", "Task description for the agent")
		.option("-a, --agent <type>", "Agent type (claude-code, codex)", "claude-code")
		.option("-b, --branch <name>", "Branch name")
		.action(async (task: string, opts: { agent: string; branch?: string }) => {
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

			const session = await ctx.sessions.create({
				projectId: ctx.config.projectId,
				task,
				agentType: opts.agent,
				workspacePath: ctx.config.rootPath,
				branch,
				metadata: {},
			});

			console.log(`Session ${session.id} created (status: ${session.status})`);

			// --- Workspace ---
			const workspace = ctx.plugins.get("workspace") as WorkspacePlugin | undefined;
			let workspacePath = ctx.config.rootPath;

			if (workspace) {
				try {
					const workspaceInfo = await workspace.create({
						projectPath: ctx.config.rootPath,
						branch,
						sessionId: session.id,
					});
					workspacePath = workspaceInfo.path;
					await ctx.sessions.update(session.id, { workspacePath: workspaceInfo.path });
					console.log(`  Workspace: ${workspaceInfo.path}`);
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					await ctx.sessions.update(session.id, { status: "failed" });
					console.error(`Failed to create workspace: ${message}`);
					return;
				}
			} else {
				console.warn("  Warning: No workspace plugin configured — using project root.");
			}

			// --- Agent command ---
			const agent = ctx.plugins.get("agent") as AgentPlugin | undefined;
			if (!agent) {
				console.warn("  Warning: No agent plugin configured — agent was not started.");
				console.log(`  Task:   ${session.task}`);
				console.log(`  Agent:  ${session.agentType}`);
				console.log(`  Branch: ${session.branch}`);
				console.log("  Status: spawning (agent not started)");
				return;
			}

			let cmd: { command: string; args: string[] };
			try {
				cmd = agent.buildCommand({
					task,
					workspacePath,
					config: ctx.config.session.agent,
				});
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				await ctx.sessions.update(session.id, { status: "failed" });
				console.error(`Failed to build agent command: ${message}`);
				return;
			}

			// --- Runtime ---
			const runtime = ctx.plugins.get("runtime") as RuntimePlugin | undefined;
			if (!runtime) {
				console.warn("  Warning: No runtime plugin configured — agent was not started.");
				console.log(`  Task:   ${session.task}`);
				console.log(`  Agent:  ${session.agentType}`);
				console.log(`  Branch: ${session.branch}`);
				console.log("  Status: spawning (runtime not available)");
				return;
			}

			try {
				const handle = await runtime.spawn({
					command: cmd.command,
					args: cmd.args,
					cwd: workspacePath,
					name: `uc-${session.id}`,
				});

				const updated = await ctx.sessions.update(session.id, {
					status: "working",
					runtimeId: handle.id,
					pid: handle.pid,
				});

				console.log(`  Task:      ${updated.task}`);
				console.log(`  Agent:     ${updated.agentType}`);
				console.log(`  Branch:    ${updated.branch}`);
				console.log(`  Workspace: ${updated.workspacePath}`);
				console.log(`  Runtime:   ${handle.id}${handle.pid ? ` (pid ${handle.pid})` : ""}`);
				console.log(`  Status:    ${updated.status}`);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				await ctx.sessions.update(session.id, { status: "failed" });
				console.error(`Failed to spawn agent: ${message}`);
			}
		});
}
