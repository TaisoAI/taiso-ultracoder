import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Command } from "commander";
import { buildContext } from "../context.js";

const exec = promisify(execFile);

export function doctorCommand(): Command {
	return new Command("doctor")
		.description("Check system health and dependencies")
		.action(async () => {
			console.log("Ultracoder Doctor\n");

			// Check config
			try {
				const ctx = await buildContext();
				check("Config", `Loaded (project: ${ctx.config.projectId})`);
			} catch (err) {
				fail("Config", err instanceof Error ? err.message : String(err));
			}

			// Check git
			await checkCommand("git", ["--version"], "Git");

			// Check tmux
			await checkCommand("tmux", ["-V"], "tmux");

			// Check claude
			await checkCommand("claude", ["--version"], "Claude Code");

			// Check codex
			await checkCommand("codex", ["--version"], "Codex");

			// Check gh
			await checkCommand("gh", ["--version"], "GitHub CLI");

			console.log("\nDone.");
		});
}

function check(label: string, detail: string): void {
	console.log(`  [OK]   ${label}: ${detail}`);
}

function fail(label: string, detail: string): void {
	console.log(`  [FAIL] ${label}: ${detail}`);
}

async function checkCommand(cmd: string, args: string[], label: string): Promise<void> {
	try {
		const { stdout } = await exec(cmd, args);
		check(label, stdout.trim().split("\n")[0]);
	} catch {
		fail(label, "not found");
	}
}
