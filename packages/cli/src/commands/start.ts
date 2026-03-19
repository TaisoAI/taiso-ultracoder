import type { AgentPlugin, RuntimePlugin, WorkspacePlugin } from "@ultracoder/core";
import { Command } from "commander";
import { buildContext } from "../context.js";

export function startCommand(): Command {
	return new Command("start")
		.description("Resume a spawning/failed session by transitioning to working")
		.argument("<session-id>", "Session ID to start")
		.action(async (sessionId: string) => {
			if (!/^[a-f0-9]{8}$/.test(sessionId)) {
				console.error(`Invalid session ID: ${sessionId}`);
				process.exit(1);
			}

			const ctx = await buildContext();
			const session = await ctx.sessions.get(sessionId);

			if (!session) {
				console.error(`Session '${sessionId}' not found`);
				process.exit(1);
			}

			if (session.status !== "spawning" && session.status !== "failed") {
				console.error(
					`Session '${sessionId}' cannot be started from status '${session.status}' (must be 'spawning' or 'failed')`,
				);
				process.exit(1);
			}

			// --- Workspace ---
			const workspace = ctx.plugins.get("workspace") as WorkspacePlugin | undefined;
			let workspacePath = session.workspacePath;

			if (workspace) {
				try {
					const workspaceInfo = await workspace.create({
						projectPath: ctx.config.rootPath,
						branch: session.branch,
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
			}

			// --- Agent command ---
			const agent = ctx.plugins.get("agent") as AgentPlugin | undefined;
			if (!agent) {
				await ctx.sessions.update(session.id, { status: "working" });
				console.log(`Session ${session.id} transitioned to working (no agent plugin configured)`);
				return;
			}

			let cmd: { command: string; args: string[] };
			try {
				cmd = agent.buildCommand({
					task: session.task,
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
				await ctx.sessions.update(session.id, { status: "working" });
				console.log(`Session ${session.id} transitioned to working (no runtime plugin configured)`);
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

				console.log(`Session ${updated.id} started`);
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
