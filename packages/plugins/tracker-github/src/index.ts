import { execFile } from "node:child_process";
import type { TrackerIssue, TrackerIssueOpts, TrackerPlugin } from "@ultracoder/core";

export interface GitHubTrackerConfig {
	repo?: string;
	ghPath?: string;
}

function exec(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		execFile(cmd, args, (error, stdout, stderr) => {
			if (error) {
				reject(error);
				return;
			}
			resolve({ stdout, stderr });
		});
	});
}

export function create(config: GitHubTrackerConfig = {}): TrackerPlugin {
	const gh = config.ghPath ?? "gh";
	const repoArgs = config.repo ? ["--repo", config.repo] : [];

	return {
		meta: {
			name: "tracker-github",
			slot: "tracker",
			version: "0.0.1",
		},

		async createIssue(opts: TrackerIssueOpts): Promise<string> {
			const args = ["issue", "create", "--title", opts.title, "--body", opts.body, ...repoArgs];

			if (opts.labels) {
				for (const label of opts.labels) {
					args.push("--label", label);
				}
			}

			if (opts.assignees) {
				for (const assignee of opts.assignees) {
					args.push("--assignee", assignee);
				}
			}

			const { stdout } = await exec(gh, args);
			const match = /\/issues\/(\d+)/.exec(stdout.trim());
			return match ? match[1] : stdout.trim();
		},

		async updateIssue(id: string, update: Partial<TrackerIssueOpts>): Promise<void> {
			const args = ["issue", "edit", id, ...repoArgs];

			if (update.title) {
				args.push("--title", update.title);
			}
			if (update.body) {
				args.push("--body", update.body);
			}
			if (update.labels) {
				for (const label of update.labels) {
					args.push("--add-label", label);
				}
			}
			if (update.assignees) {
				for (const assignee of update.assignees) {
					args.push("--add-assignee", assignee);
				}
			}

			await exec(gh, args);
		},

		async getIssue(id: string): Promise<TrackerIssue> {
			const { stdout } = await exec(gh, [
				"issue",
				"view",
				id,
				"--json",
				"number,title,body,state,url,labels,assignees",
				...repoArgs,
			]);

			const data = JSON.parse(stdout) as Record<string, unknown>;
			const labels = Array.isArray(data.labels)
				? (data.labels as Array<{ name: string }>).map((l) => l.name)
				: [];
			const assignees = Array.isArray(data.assignees)
				? (data.assignees as Array<{ login: string }>).map((a) => a.login)
				: [];

			return {
				id: String(data.number),
				title: String(data.title),
				body: String(data.body),
				state: (data.state as string).toLowerCase() === "open" ? "open" : "closed",
				url: String(data.url),
				labels,
				assignees,
			};
		},
	};
}

export default create;
