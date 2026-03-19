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

			console.log(`Session ${session.id} created`);
			console.log(`  Task:   ${session.task}`);
			console.log(`  Agent:  ${session.agentType}`);
			console.log(`  Branch: ${session.branch}`);
			console.log(`  Status: ${session.status}`);

			// TODO: Wire up runtime + agent plugins to actually start the agent
			// For now, just create the session record
		});
}
