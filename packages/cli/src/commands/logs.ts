import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import { buildContext } from "../context.js";

const SESSION_ID_PATTERN = /^[a-f0-9]{8}$/;

export function logsCommand(): Command {
	return new Command("logs")
		.description("View session activity logs")
		.argument("<session-id>", "Session ID (8-char hex)")
		.option("-f, --follow", "Follow the log file for new entries")
		.action(async (sessionId: string, opts: { follow?: boolean }) => {
			if (!SESSION_ID_PATTERN.test(sessionId)) {
				console.error(`Invalid session ID '${sessionId}'. Must match /^[a-f0-9]{8}$/.`);
				process.exit(1);
			}

			const ctx = await buildContext();
			const logsDir = ctx.paths.logsDir(sessionId);
			const logFile = path.join(logsDir, "activity.jsonl");

			if (!fs.existsSync(logFile)) {
				console.error(`No activity log found for session '${sessionId}'.`);
				process.exit(1);
			}

			// Print existing content
			const content = fs.readFileSync(logFile, "utf-8");
			if (content.length > 0) {
				process.stdout.write(content);
				if (!content.endsWith("\n")) {
					process.stdout.write("\n");
				}
			}

			if (!opts.follow) {
				return;
			}

			// Follow mode: watch for changes
			let position = fs.statSync(logFile).size;

			const watcher = fs.watch(logFile, () => {
				const stat = fs.statSync(logFile);
				if (stat.size > position) {
					const fd = fs.openSync(logFile, "r");
					const buf = Buffer.alloc(stat.size - position);
					fs.readSync(fd, buf, 0, buf.length, position);
					fs.closeSync(fd);
					process.stdout.write(buf.toString("utf-8"));
					position = stat.size;
				}
			});

			process.on("SIGINT", () => {
				watcher.close();
				process.exit(0);
			});
		});
}
