import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { WorkspaceCreateOpts, WorkspaceInfo, WorkspacePlugin } from "@ultracoder/core";

export interface CloneWorkspaceConfig {
	basePath?: string;
	depth?: number;
}

function exec(
	cmd: string,
	args: string[],
	cwd?: string,
): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		execFile(cmd, args, { cwd }, (error, stdout, stderr) => {
			if (error) {
				reject(error);
				return;
			}
			resolve({ stdout, stderr });
		});
	});
}

export function create(config: CloneWorkspaceConfig = {}): WorkspacePlugin {
	return {
		meta: {
			name: "workspace-clone",
			slot: "workspace",
			version: "0.0.1",
		},

		async create(opts: WorkspaceCreateOpts): Promise<WorkspaceInfo> {
			const base = config.basePath ?? join(opts.projectPath, ".clones");
			const clonePath = join(base, opts.sessionId);

			const cloneArgs = ["clone", opts.projectPath, clonePath];
			if (config.depth) {
				cloneArgs.push("--depth", String(config.depth));
			}

			await exec("git", cloneArgs);
			await exec("git", ["checkout", "-b", opts.branch], clonePath);

			return {
				path: clonePath,
				branch: opts.branch,
				isTemporary: true,
			};
		},

		async cleanup(info: WorkspaceInfo): Promise<void> {
			await rm(info.path, { recursive: true, force: true });
		},
	};
}

export default create;
