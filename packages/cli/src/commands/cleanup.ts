import { Command } from "commander";
import { buildContext } from "../context.js";

export function cleanupCommand(): Command {
	return new Command("cleanup")
		.description("Clean up completed/failed sessions")
		.option("--all", "Clean up all non-running sessions")
		.option("--older-than <days>", "Clean sessions older than N days", "7")
		.action(async (opts: { all?: boolean; olderThan: string }) => {
			const ctx = await buildContext();
			const sessions = await ctx.sessions.list();
			const days = Number.parseInt(opts.olderThan, 10);
			if (Number.isNaN(days) || days < 0) {
				console.error(`Invalid --older-than value: ${opts.olderThan}`);
				process.exit(1);
			}
			const maxAge = days * 24 * 60 * 60 * 1000;
			const now = Date.now();
			let cleaned = 0;

			for (const session of sessions) {
				const age = now - new Date(session.createdAt).getTime();
				const isTerminal = ["merged", "failed", "killed", "archived"].includes(session.status);

				if (opts.all ? isTerminal : isTerminal && age > maxAge) {
					await ctx.sessions.delete(session.id);
					cleaned++;
				}
			}

			console.log(`Cleaned up ${cleaned} session(s)`);
		});
}
