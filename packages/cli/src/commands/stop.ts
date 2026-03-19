import type { RuntimePlugin } from "@ultracoder/core";
import { Command } from "commander";
import { buildContext } from "../context.js";

export function stopCommand(): Command {
	return new Command("stop")
		.description("Gracefully pause a working session (can be started again later)")
		.argument("<session-id>", "Session ID to stop")
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

			if (session.status !== "working") {
				console.error(
					`Session '${sessionId}' is not working (current status: '${session.status}')`,
				);
				process.exit(1);
			}

			// Send SIGTERM to runtime if available
			if (session.runtimeId) {
				const runtime = ctx.plugins.get("runtime") as RuntimePlugin | undefined;
				if (runtime) {
					try {
						await runtime.kill({ id: session.runtimeId });
					} catch {
						// Best effort — process may already be gone
					}
				}
			}

			await ctx.sessions.update(sessionId, { status: "failed" });
			console.log(
				`Session ${sessionId} stopped (status: failed — can be started again with 'uc start')`,
			);
		});
}
