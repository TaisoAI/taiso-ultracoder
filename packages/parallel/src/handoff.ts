import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { appendJsonl, readJsonl } from "@ultracoder/core";

const execFile = promisify(execFileCb);

export interface HandoffMetrics {
	linesAdded: number;
	linesRemoved: number;
	filesChanged: string[];
	tokensUsed?: number;
	toolCallCount?: number;
	durationMs?: number;
}

export interface HandoffReport {
	sessionId: string;
	task: string;
	status: "completed" | "partial" | "failed";
	summary: string;
	diff: string;
	metrics: HandoffMetrics;
	concerns: string[];
	suggestions: string[];
	timestamp: string;
}

/**
 * Generate a handoff report from a completed session's workspace.
 */
export async function generateHandoffReport(opts: {
	sessionId: string;
	task: string;
	workspacePath: string;
	status: "completed" | "partial" | "failed";
	summary?: string;
	concerns?: string[];
	suggestions?: string[];
}): Promise<HandoffReport> {
	const execOpts = { cwd: opts.workspacePath };

	// Get full diff
	let diff = "";
	try {
		const { stdout } = await execFile("git", ["diff", "HEAD~1"], execOpts);
		diff = stdout;
	} catch {
		// No previous commit or other error — leave diff empty
	}

	// Get diff stats for lines added/removed
	let linesAdded = 0;
	let linesRemoved = 0;
	try {
		const { stdout } = await execFile("git", ["diff", "--numstat", "HEAD~1"], execOpts);
		for (const line of stdout.split("\n")) {
			const parts = line.trim().split(/\s+/);
			if (parts.length >= 2) {
				const added = Number.parseInt(parts[0], 10);
				const removed = Number.parseInt(parts[1], 10);
				if (!Number.isNaN(added)) linesAdded += added;
				if (!Number.isNaN(removed)) linesRemoved += removed;
			}
		}
	} catch {
		// ignore
	}

	// Get changed file names
	let filesChanged: string[] = [];
	try {
		const { stdout } = await execFile("git", ["diff", "--name-only", "HEAD~1"], execOpts);
		filesChanged = stdout
			.split("\n")
			.map((f) => f.trim())
			.filter((f) => f.length > 0);
	} catch {
		// ignore
	}

	return {
		sessionId: opts.sessionId,
		task: opts.task,
		status: opts.status,
		summary: opts.summary ?? "",
		diff,
		metrics: {
			linesAdded,
			linesRemoved,
			filesChanged,
		},
		concerns: opts.concerns ?? [],
		suggestions: opts.suggestions ?? [],
		timestamp: new Date().toISOString(),
	};
}

/**
 * Save a handoff report to a JSONL file.
 */
export async function saveHandoffReport(filePath: string, report: HandoffReport): Promise<void> {
	await appendJsonl(filePath, report);
}

/**
 * Read all handoff reports from a JSONL file.
 */
export async function readHandoffReports(filePath: string): Promise<HandoffReport[]> {
	return readJsonl<HandoffReport>(filePath);
}
