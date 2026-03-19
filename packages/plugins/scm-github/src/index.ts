import { execFile } from "node:child_process";
import type {
	CIStatus,
	CIStatusState,
	MergeStrategy,
	PullRequestOpts,
	PullRequestStatus,
	ScmPlugin,
} from "@ultracoder/core";

export interface GitHubScmConfig {
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

export function create(config: GitHubScmConfig = {}): ScmPlugin {
	const gh = config.ghPath ?? "gh";
	const repoArgs = config.repo ? ["--repo", config.repo] : [];

	return {
		meta: {
			name: "scm-github",
			slot: "scm",
			version: "0.0.1",
		},

		async createPR(opts: PullRequestOpts): Promise<string> {
			const args = [
				"pr",
				"create",
				"--title",
				opts.title,
				"--body",
				opts.body,
				"--head",
				opts.head,
				"--base",
				opts.base,
				...repoArgs,
			];

			if (opts.draft) {
				args.push("--draft");
			}

			const { stdout } = await exec(gh, args);
			const match = /\/pull\/(\d+)/.exec(stdout.trim());
			return match ? match[1] : stdout.trim();
		},

		async getPRStatus(id: string): Promise<PullRequestStatus> {
			const { stdout } = await exec(gh, [
				"pr",
				"view",
				id,
				"--json",
				"number,state,mergeable,reviewDecision,statusCheckRollup",
				...repoArgs,
			]);

			const data = JSON.parse(stdout) as Record<string, unknown>;

			const mapState = (s: string) => {
				const lower = s.toLowerCase();
				if (lower === "merged") return "merged" as const;
				if (lower === "closed") return "closed" as const;
				return "open" as const;
			};

			const mapReviewDecision = (d: unknown) => {
				if (typeof d !== "string") return undefined;
				const lower = d.toLowerCase();
				if (lower === "approved") return "approved" as const;
				if (lower === "changes_requested") return "changes_requested" as const;
				return "review_required" as const;
			};

			const checks = Array.isArray(data.statusCheckRollup)
				? (data.statusCheckRollup as Array<Record<string, unknown>>)
				: [];

			const mapCheckState = (s: unknown): CIStatusState => {
				if (typeof s !== "string") return "pending";
				const lower = s.toLowerCase();
				if (lower === "success") return "success";
				if (lower === "failure") return "failure";
				if (lower === "error") return "error";
				return "pending";
			};

			const ciChecks = checks.map((c) => ({
				name: String(c.name ?? c.context ?? "unknown"),
				status: mapCheckState(c.conclusion ?? c.status),
				url: typeof c.detailsUrl === "string" ? c.detailsUrl : undefined,
			}));

			const overallState: CIStatusState =
				ciChecks.length === 0
					? "pending"
					: ciChecks.some((c) => c.status === "failure" || c.status === "error")
						? "failure"
						: ciChecks.every((c) => c.status === "success")
							? "success"
							: "pending";

			return {
				id: String(data.number),
				state: mapState(String(data.state)),
				mergeable: data.mergeable === "MERGEABLE",
				reviewDecision: mapReviewDecision(data.reviewDecision),
				ciStatus: { state: overallState, checks: ciChecks },
			};
		},

		async mergePR(id: string, strategy?: MergeStrategy): Promise<void> {
			const args = ["pr", "merge", id, ...repoArgs];
			const flag =
				strategy === "rebase" ? "--rebase" : strategy === "squash" ? "--squash" : "--merge";
			args.push(flag);

			await exec(gh, args);
		},

		async getCIStatus(ref: string): Promise<CIStatus> {
			const { stdout } = await exec(gh, [
				"run",
				"list",
				"--commit",
				ref,
				"--json",
				"name,status,conclusion,url",
				...repoArgs,
			]);

			const runs = JSON.parse(stdout) as Array<Record<string, unknown>>;

			const mapState = (r: Record<string, unknown>): CIStatusState => {
				const conclusion = String(r.conclusion ?? "");
				if (conclusion === "success") return "success";
				if (conclusion === "failure") return "failure";
				if (conclusion === "cancelled" || conclusion === "timed_out") return "error";
				return "pending";
			};

			const checks = runs.map((r) => ({
				name: String(r.name),
				status: mapState(r),
				url: typeof r.url === "string" ? r.url : undefined,
			}));

			const overallState: CIStatusState =
				checks.length === 0
					? "pending"
					: checks.some((c) => c.status === "failure" || c.status === "error")
						? "failure"
						: checks.every((c) => c.status === "success")
							? "success"
							: "pending";

			return { state: overallState, checks };
		},
	};
}

export default create;
