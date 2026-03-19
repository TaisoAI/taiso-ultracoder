import { Command } from "commander";
import { buildContext } from "../context.js";

function formatDuration(createdAt: string): string {
	const ms = Date.now() - new Date(createdAt).getTime();
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);

	if (hours > 0) {
		return `${hours}h ${minutes % 60}m`;
	}
	if (minutes > 0) {
		return `${minutes}m ${seconds % 60}s`;
	}
	return `${seconds}s`;
}

export function watchCommand(): Command {
	return new Command("watch")
		.description("Continuously watch agent session status")
		.action(async () => {
			const ctx = await buildContext();

			const render = async () => {
				console.clear();
				const sessions = await ctx.sessions.list();

				if (sessions.length === 0) {
					console.log("No sessions found. Watching...");
					return;
				}

				console.log(
					`${"ID".padEnd(10)} ${"Status".padEnd(14)} ${"Agent".padEnd(14)} ${"Duration".padEnd(10)} Task`,
				);
				console.log("-".repeat(70));
				for (const s of sessions) {
					console.log(
						`${s.id.padEnd(10)} ${s.status.padEnd(14)} ${s.agentType.padEnd(14)} ${formatDuration(s.createdAt).padEnd(10)} ${s.task}`,
					);
				}
			};

			await render();
			const interval = setInterval(render, 2000);

			process.on("SIGINT", () => {
				clearInterval(interval);
				process.exit(0);
			});
		});
}
