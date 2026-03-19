import { execFile } from "node:child_process";
import { join } from "node:path";
import type { WorkspaceCreateOpts, WorkspaceInfo, WorkspacePlugin } from "@ultracoder/core";

export interface WorktreeWorkspaceConfig {
	basePath?: string;
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

export function create(config: WorktreeWorkspaceConfig = {}): WorkspacePlugin {
	return {
		meta: {
			name: "workspace-worktree",
			slot: "workspace",
			version: "0.0.1",
		},

		async create(opts: WorkspaceCreateOpts): Promise<WorkspaceInfo> {
			const base = config.basePath ?? join(opts.projectPath, ".worktrees");
			const worktreePath = join(base, opts.sessionId);

			await exec("git", ["worktree", "add", "-b", opts.branch, worktreePath], opts.projectPath);

			return {
				path: worktreePath,
				branch: opts.branch,
				isTemporary: true,
			};
		},

		async cleanup(info: WorkspaceInfo): Promise<void> {
			await exec("git", ["worktree", "remove", info.path]);
		},
	};
}

export default create;
