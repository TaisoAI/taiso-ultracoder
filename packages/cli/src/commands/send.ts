import { Command } from "commander";
import { buildContext } from "../context.js";

export function sendCommand(): Command {
	return new Command("send")
		.description("Send a message to a running agent session")
		.argument("<session-id>", "Session ID")
		.argument("<message>", "Message to send")
		.action(async (sessionId: string, message: string) => {
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
				console.error(`Session '${sessionId}' is not working (status: ${session.status})`);
				process.exit(1);
			}

			const runtime = ctx.plugins.get("runtime");
			if (!runtime || !session.runtimeId) {
				console.error("No runtime available to send input");
				process.exit(1);
			}

			await runtime.sendInput({ id: session.runtimeId }, message);
			console.log(`Sent message to session ${sessionId}`);
		});
}
