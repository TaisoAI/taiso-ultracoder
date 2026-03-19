import { execFile as execFileCb } from "node:child_process";
import * as fs from "node:fs";
import { promisify } from "node:util";
import type { Deps, Session } from "@ultracoder/core";
import { canTransition } from "./state-machine.js";

const execFile = promisify(execFileCb);

export interface AutoResumeConfig {
	enabled: boolean;
	cooldownSeconds: number;
	maxRetries: number;
}

const DEFAULT_CONFIG: AutoResumeConfig = {
	enabled: true,
	cooldownSeconds: 30,
	maxRetries: 3,
};

export interface ResumeContext {
	originalTask: string;
	gitDiff: string;
	progressSummary: string;
	filesChanged: string[];
	retryCount: number;
}

/**
 * Build structured context for a resumed session by extracting
 * the original task, git diff, and progress summary.
 */
export async function buildResumeContext(session: Session, deps: Deps): Promise<ResumeContext> {
	const retryCount =
		typeof session.metadata.retryCount === "number" && Number.isFinite(session.metadata.retryCount)
			? session.metadata.retryCount
			: 0;

	const cwd = session.workspacePath;
	const execOpts = { cwd, maxBuffer: 1024 * 1024 };

	let gitDiffStat = "";
	let gitDiff = "";
	let gitLog = "";

	try {
		const result = await execFile(
			"git",
			["diff", `${deps.config.defaultBranch}...HEAD`, "--stat"],
			execOpts,
		);
		gitDiffStat = result.stdout.trim();
	} catch {
		// git command failed — workspace may not be a git repo or main doesn't exist
	}

	try {
		const result = await execFile("git", ["diff", `${deps.config.defaultBranch}...HEAD`], execOpts);
		gitDiff = result.stdout.trim();
	} catch {
		// ignore
	}

	try {
		const result = await execFile(
			"git",
			["log", "--oneline", `${deps.config.defaultBranch}...HEAD`],
			execOpts,
		);
		gitLog = result.stdout.trim();
	} catch {
		// ignore
	}

	const filesChanged = gitDiffStat
		? gitDiffStat
				.split("\n")
				.filter((line) => line.includes("|"))
				.map((line) => line.split("|")[0].trim())
		: [];

	const progressSummary = gitLog || "No commits yet beyond main.";

	return {
		originalTask: session.task,
		gitDiff,
		progressSummary,
		filesChanged,
		retryCount,
	};
}

/**
 * Format resume context as markdown for the progress file.
 */
function formatProgressMarkdown(ctx: ResumeContext): string {
	const lines: string[] = [
		"# Resume Context",
		"",
		"## Original Task",
		"",
		ctx.originalTask,
		"",
		"## Progress Summary",
		"",
		ctx.progressSummary,
		"",
		`## Files Changed (${ctx.filesChanged.length})`,
		"",
	];

	for (const f of ctx.filesChanged) {
		lines.push(`- ${f}`);
	}

	lines.push("", "## Git Diff", "", "```diff", ctx.gitDiff || "(no diff)", "```", "");
	lines.push(`## Retry Count: ${ctx.retryCount}`, "");

	return lines.join("\n");
}

/**
 * Write resume context to .ultracoder/progress.md in the workspace.
 */
async function writeProgressFile(workspacePath: string, ctx: ResumeContext): Promise<void> {
	const dir = `${workspacePath}/.ultracoder`;
	await fs.promises.mkdir(dir, { recursive: true });
	await fs.promises.writeFile(`${dir}/progress.md`, formatProgressMarkdown(ctx), "utf-8");
}

/**
 * Auto-resume: detects context exhaustion and restarts
 * sessions with a cooldown period.
 */
export async function handleAutoResume(
	session: Session,
	deps: Deps,
	config?: Partial<AutoResumeConfig>,
): Promise<boolean> {
	const cfg = { ...DEFAULT_CONFIG, ...config };
	const logger = deps.logger.child({ component: "auto-resume", sessionId: session.id });

	if (!cfg.enabled) {
		logger.debug("Auto-resume disabled");
		return false;
	}

	const retryCount =
		typeof session.metadata.retryCount === "number" && Number.isFinite(session.metadata.retryCount)
			? session.metadata.retryCount
			: 0;
	if (retryCount >= cfg.maxRetries) {
		logger.warn("Max retries exceeded", { retryCount, maxRetries: cfg.maxRetries });
		return false;
	}

	// Choose correct event based on current state
	const resumeEvent = ["merge_conflicts", "changes_requested", "ci_failed"].includes(session.status)
		? "resolve"
		: "start";
	const transition = canTransition(session.status, resumeEvent);
	if (!transition.valid) {
		logger.debug("Cannot resume from current state", { status: session.status });
		return false;
	}

	// Build resume context before cooldown (captures current state)
	let resumeContext: ResumeContext | undefined;
	try {
		resumeContext = await buildResumeContext(session, deps);
	} catch (err) {
		logger.warn("Failed to build resume context", { error: String(err) });
	}

	// Apply cooldown
	logger.info(`Cooling down for ${cfg.cooldownSeconds}s before resume`);
	await sleep(cfg.cooldownSeconds * 1000);

	// Re-read session after cooldown — state may have changed
	const fresh = await deps.sessions.get(session.id);
	if (!fresh) {
		logger.warn("Session no longer exists after cooldown");
		return false;
	}

	const freshEvent = ["merge_conflicts", "changes_requested", "ci_failed"].includes(fresh.status)
		? "resolve"
		: "start";
	const postCooldownTransition = canTransition(fresh.status, freshEvent);
	if (!postCooldownTransition.valid) {
		logger.debug("Cannot resume after cooldown — state changed", { status: fresh.status });
		return false;
	}

	const freshRetryCount =
		typeof fresh.metadata.retryCount === "number" && Number.isFinite(fresh.metadata.retryCount)
			? fresh.metadata.retryCount
			: 0;

	// Write progress file before transitioning
	if (resumeContext) {
		try {
			await writeProgressFile(session.workspacePath, resumeContext);
		} catch (err) {
			logger.warn("Failed to write progress file", { error: String(err) });
		}
	}

	// Update session with incremented retry count and resume context
	await deps.sessions.update(session.id, {
		status: "working",
		metadata: {
			...fresh.metadata,
			retryCount: freshRetryCount + 1,
			lastResumeAt: new Date().toISOString(),
			resumeContext: resumeContext ?? undefined,
		},
	});

	logger.info("Session auto-resumed", { retryCount: retryCount + 1 });
	return true;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
