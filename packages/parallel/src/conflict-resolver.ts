import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { Logger } from "@ultracoder/core";

const execFile = promisify(execFileCb);

const MAX_BUFFER = 10 * 1024 * 1024;

export interface ConflictTask {
	task: string;
	branch: string;
	targetBranch: string;
	conflictFiles: string[];
	metadata: Record<string, unknown>;
}

/**
 * Identify which files conflict between two branches without modifying the working tree.
 *
 * Strategy 1: Use `git merge-tree` (read-only, no checkout needed).
 * Strategy 2 (fallback): Attempt a `--no-commit --no-ff` merge, read conflicting files, then abort.
 * On any error, returns an empty array (graceful degradation).
 */
export async function identifyConflictFiles(
	branch: string,
	targetBranch: string,
	cwd: string,
): Promise<string[]> {
	try {
		return await identifyViaTree(branch, targetBranch, cwd);
	} catch {
		// Strategy 1 failed — try fallback
	}

	try {
		return await identifyViaFallbackMerge(branch, targetBranch, cwd);
	} catch {
		// Fallback also failed — graceful degradation
	}

	return [];
}

async function identifyViaTree(
	branch: string,
	targetBranch: string,
	cwd: string,
): Promise<string[]> {
	const { stdout: mergeBase } = await execFile(
		"git",
		["merge-base", targetBranch, branch],
		{ cwd, maxBuffer: MAX_BUFFER },
	);

	const { stdout } = await execFile(
		"git",
		["merge-tree", mergeBase.trim(), targetBranch, branch],
		{ cwd, maxBuffer: MAX_BUFFER },
	);

	// Parse output for conflict markers
	const conflictFiles: string[] = [];
	const lines = stdout.split("\n");
	for (const line of lines) {
		if (line.startsWith("+<<") || line.includes("<<<<<<<") || line.includes(">>>>>>>")) {
			// Look backwards for the filename from a preceding "changed in both" or "+++ b/" line
			continue;
		}
		// merge-tree outputs filenames after "changed in both" or in diff headers like "+++ b/path"
		const diffMatch = line.match(/^\+\+\+ b\/(.+)$/);
		if (diffMatch) {
			conflictFiles.push(diffMatch[1]);
		}
	}

	if (conflictFiles.length === 0) {
		// If no +++ headers found, try to find conflict markers and report the whole output indicates conflicts
		const hasConflictMarkers = lines.some(
			(l) => l.startsWith("+<<") || l.includes("<<<<<<<") || l.includes("=======") || l.includes(">>>>>>>"),
		);
		if (!hasConflictMarkers) {
			throw new Error("No conflicts detected in merge-tree output");
		}
	}

	// Deduplicate
	return [...new Set(conflictFiles)];
}

async function identifyViaFallbackMerge(
	branch: string,
	targetBranch: string,
	cwd: string,
): Promise<string[]> {
	try {
		await execFile(
			"git",
			["merge", "--no-commit", "--no-ff", branch],
			{ cwd, maxBuffer: MAX_BUFFER },
		);
		// If merge succeeds, no conflicts — abort and return empty
		await execFile("git", ["merge", "--abort"], { cwd, maxBuffer: MAX_BUFFER }).catch(() => {});
		return [];
	} catch {
		// Merge failed (likely due to conflicts) — capture conflicting files
	}

	try {
		const { stdout } = await execFile(
			"git",
			["diff", "--name-only", "--diff-filter=U"],
			{ cwd, maxBuffer: MAX_BUFFER },
		);
		const files = stdout
			.split("\n")
			.map((f) => f.trim())
			.filter(Boolean);

		// Always abort the merge to clean up
		await execFile("git", ["merge", "--abort"], { cwd, maxBuffer: MAX_BUFFER }).catch(() => {});

		return files;
	} catch {
		// Make sure we still try to abort
		await execFile("git", ["merge", "--abort"], { cwd, maxBuffer: MAX_BUFFER }).catch(() => {});
		throw new Error("Failed to identify conflict files via fallback merge");
	}
}

/**
 * Generate a conflict-resolution task description for a branch that has merge conflicts.
 */
export async function generateConflictTask(opts: {
	branch: string;
	targetBranch: string;
	sessionId: string;
	originalTask: string;
	cwd: string;
	logger: Logger;
}): Promise<ConflictTask> {
	const { branch, targetBranch, sessionId, originalTask, cwd, logger } = opts;

	logger.info(`Generating conflict task for branch '${branch}' vs '${targetBranch}'`);

	const conflictFiles = await identifyConflictFiles(branch, targetBranch, cwd);

	const fileList =
		conflictFiles.length > 0
			? conflictFiles.map((f) => `- ${f}`).join("\n")
			: "- (unable to determine — check manually)";

	const task = `Resolve merge conflicts between branch '${branch}' and '${targetBranch}'.

Conflicting files:
${fileList}

Original task context: ${originalTask}

Steps:
1. Check out the branch and attempt to merge ${targetBranch}
2. Resolve all conflict markers (<<<<<<< ======= >>>>>>>)
3. Ensure the code compiles and tests pass
4. Commit the resolved merge`;

	return {
		task,
		branch,
		targetBranch,
		conflictFiles,
		metadata: {
			source: "conflict-resolver",
			originalSessionId: sessionId,
		},
	};
}
