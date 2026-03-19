import { Command } from "commander";
import { buildContext } from "../context.js";

export function statusCommand(): Command {
	return new Command("status")
		.description("Show status of agent sessions")
		.option("-s, --session <id>", "Show specific session")
		.option("--json", "Output as JSON")
		.action(async (opts: { session?: string; json?: boolean }) => {
			if (opts.session && !/^[a-f0-9]{8}$/.test(opts.session)) {
				console.error(`Invalid session ID: ${opts.session}`);
				process.exit(1);
			}

			const ctx = await buildContext();

			if (opts.session) {
				const session = await ctx.sessions.get(opts.session);
				if (!session) {
					console.error(`Session '${opts.session}' not found`);
					process.exit(1);
				}
				if (opts.json) {
					console.log(JSON.stringify(session, null, 2));
				} else {
					printSession(session);
				}
				return;
			}

			const sessions = await ctx.sessions.list();
			if (sessions.length === 0) {
				console.log("No sessions found");
				return;
			}

			if (opts.json) {
				console.log(JSON.stringify(sessions, null, 2));
				return;
			}

			console.log(`${"ID".padEnd(10)} ${"Status".padEnd(12)} ${"Agent".padEnd(14)} Task`);
			console.log("-".repeat(60));
			for (const s of sessions) {
				console.log(
					`${s.id.padEnd(10)} ${s.status.padEnd(12)} ${s.agentType.padEnd(14)} ${s.task}`,
				);
			}
		});
}

function printSession(s: {
	id: string;
	status: string;
	task: string;
	agentType: string;
	branch: string;
	createdAt: string;
	updatedAt: string;
}): void {
	console.log(`Session:  ${s.id}`);
	console.log(`Status:   ${s.status}`);
	console.log(`Task:     ${s.task}`);
	console.log(`Agent:    ${s.agentType}`);
	console.log(`Branch:   ${s.branch}`);
	console.log(`Created:  ${s.createdAt}`);
	console.log(`Updated:  ${s.updatedAt}`);
}
