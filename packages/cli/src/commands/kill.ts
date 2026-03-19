import { Command } from "commander";
import { buildContext } from "../context.js";

export function killCommand(): Command {
	return new Command("kill")
		.description("Kill an agent session and archive it")
		.argument("<session-id>", "Session ID to kill")
		.option("-f, --force", "Force kill without confirmation")
		.action(async (sessionId: string, _opts: { force?: boolean }) => {
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

			// Kill the runtime if it has one (regardless of state)
			if (session.runtimeId) {
				const runtime = ctx.plugins.get("runtime");
				if (runtime) {
					try {
						await runtime.kill({ id: session.runtimeId });
					} catch {
						// Best effort
					}
				}
			}

			await ctx.sessions.update(sessionId, { status: "killed" });
			await ctx.sessions.archive(sessionId);
			console.log(`Session ${sessionId} killed and archived`);
		});
}
