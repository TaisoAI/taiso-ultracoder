import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";

export function initCommand(): Command {
	return new Command("init")
		.description("Initialize ultracoder config in the current project")
		.option("-p, --project-id <id>", "Project identifier")
		.action(async (opts: { projectId?: string }) => {
			const cwd = process.cwd();
			const projectId = opts.projectId ?? path.basename(cwd);
			const configPath = path.join(cwd, "ultracoder.yaml");

			if (fs.existsSync(configPath)) {
				console.log(`Config already exists at ${configPath}`);
				return;
			}

			const config = [
				`projectId: ${projectId}`,
				"rootPath: .",
				"defaultBranch: main",
				"",
				"session:",
				"  agent:",
				"    type: claude-code",
				"  quality:",
				"    gates:",
				"      lint: true",
				"      test: true",
				"      typecheck: true",
				"",
				"workspace:",
				"  strategy: worktree",
				"",
			].join("\n");

			await fs.promises.writeFile(configPath, config, "utf-8");
			console.log(`Created ${configPath}`);
		});
}
