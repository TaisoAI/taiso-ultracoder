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

			// Load config to determine which plugins are configured
			let pluginPackages: Record<string, string> = {};
			try {
				const ctx = await buildContext();
				check("Config", `Loaded (project: ${ctx.config.projectId})`);
				for (const [slot, ref] of Object.entries(ctx.config.plugins)) {
					pluginPackages[slot] = ref.package;
				}
			} catch (err) {
				fail("Config", err instanceof Error ? err.message : String(err));
			}

			// Always check git
			await checkCommand("git", ["--version"], "Git");

			// Runtime checks — only check what's configured
			const runtimePkg = pluginPackages.runtime ?? "";
			if (isPackage(runtimePkg, "plugin-runtime-tmux")) {
				await checkCommand("tmux", ["-V"], "tmux");
			} else if (isPackage(runtimePkg, "plugin-runtime-docker")) {
				await checkCommand("docker", ["--version"], "Docker");
			} else if (isPackage(runtimePkg, "plugin-runtime-process")) {
				skip("tmux", "not required (using runtime-process)");
			} else if (runtimePkg) {
				skip("tmux", `not required (using ${runtimePkg})`);
			} else {
				await checkCommand("tmux", ["-V"], "tmux");
			}

			// Agent checks — only check the configured agent CLI
			const agentPkg = pluginPackages.agent ?? "";
			if (isPackage(agentPkg, "plugin-agent-claude-code")) {
				await checkCommand("claude", ["--version"], "Claude Code");
			} else if (isPackage(agentPkg, "plugin-agent-codex")) {
				await checkCommand("codex", ["--version"], "Codex");
			} else if (!agentPkg) {
				// No agent configured — check both as defaults
				await checkCommand("claude", ["--version"], "Claude Code");
				await checkCommand("codex", ["--version"], "Codex");
			}

			// GitHub CLI — only if tracker or scm uses github
			const trackerPkg = pluginPackages.tracker ?? "";
			const scmPkg = pluginPackages.scm ?? "";
			if (
				isPackage(trackerPkg, "plugin-tracker-github") ||
				isPackage(scmPkg, "plugin-scm-github") ||
				(!trackerPkg && !scmPkg)
			) {
				await checkCommand("gh", ["--version"], "GitHub CLI");
			} else {
				skip("gh", "not required (no GitHub plugins configured)");
			}

			console.log("\nDone.");
		});
}

function check(label: string, detail: string): void {
	console.log(`  [OK]   ${label}: ${detail}`);
}

function fail(label: string, detail: string): void {
	console.log(`  [FAIL] ${label}: ${detail}`);
}

function skip(label: string, detail: string): void {
	console.log(`  [SKIP] ${label}: ${detail}`);
}

/** Check if a package name matches a known plugin (handles @ultracoder/ prefix). */
function isPackage(pkg: string, name: string): boolean {
	return pkg === `@ultracoder/${name}` || pkg === name;
}

async function checkCommand(cmd: string, args: string[], label: string): Promise<void> {
	try {
		const { stdout } = await exec(cmd, args);
		check(label, stdout.trim().split("\n")[0]);
	} catch {
		fail(label, "not found");
	}
}
