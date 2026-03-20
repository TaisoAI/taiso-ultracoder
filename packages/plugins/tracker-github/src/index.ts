import { execFile } from "node:child_process";
import type { TrackerIssue, TrackerIssueOpts, TrackerListOpts, TrackerPlugin } from "@ultracoder/core";

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

function validateId(id: string): void {
	if (!/^\d+$/.test(id)) {
		throw new Error(`Invalid ID "${id}": must be a numeric string`);
	}
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
			validateId(id);
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

		async listIssues(opts?: TrackerListOpts): Promise<TrackerIssue[]> {
			const args = [
				"issue",
				"list",
				"--json",
				"number,title,body,state,url,labels,assignees",
				...repoArgs,
			];
			if (opts?.state) args.push("--state", opts.state);
			if (opts?.labels?.length) args.push("--label", opts.labels.join(","));
			if (opts?.assignee) args.push("--assignee", opts.assignee);
			if (opts?.query) args.push("--search", opts.query);
			if (opts?.limit) args.push("--limit", String(opts.limit));

			const { stdout } = await exec(gh, args);
			const items = JSON.parse(stdout) as Array<Record<string, unknown>>;
			return items.map((data) => {
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
					state: (data.state as string).toLowerCase() === "open" ? "open" as const : "closed" as const,
					url: String(data.url),
					labels,
					assignees,
				};
			});
		},

		async addComment(issueId: string, body: string): Promise<string> {
			validateId(issueId);
			const { stdout } = await exec(gh, [
				"issue",
				"comment",
				issueId,
				"--body",
				body,
				...repoArgs,
			]);
			return stdout.trim();
		},

		async getIssue(id: string): Promise<TrackerIssue> {
			validateId(id);
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
