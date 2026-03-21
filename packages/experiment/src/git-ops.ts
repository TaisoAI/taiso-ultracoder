import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

/**
 * Commit all current changes with a structured experiment message.
 * Returns the commit SHA.
 */
export async function commitIteration(
	cwd: string,
	iteration: number,
	metricName: string,
	metricValue: number,
	description?: string,
): Promise<string> {
	await execFile("git", ["add", "-A"], { cwd });

	// Check if there are staged changes
	try {
		await execFile("git", ["diff", "--cached", "--quiet"], { cwd });
		// If diff --quiet succeeds, there are no changes — still return HEAD
		const { stdout } = await execFile("git", ["rev-parse", "HEAD"], { cwd });
		return stdout.trim();
	} catch {
		// diff --quiet exits non-zero when there ARE changes — proceed with commit
	}

	const summary = description ? `: ${description}` : "";
	const message = `experiment(iter-${iteration})${summary}\n\nMetric: ${metricName}=${metricValue}`;

	await execFile("git", ["commit", "-m", message], { cwd });

	const { stdout } = await execFile("git", ["rev-parse", "HEAD"], { cwd });
	return stdout.trim();
}

/**
 * Discard all uncommitted changes, restoring the workspace to the last commit.
 */
export async function discardChanges(cwd: string): Promise<void> {
	await execFile("git", ["reset", "HEAD", "--", "."], { cwd });
	await execFile("git", ["checkout", "--", "."], { cwd });
	await execFile("git", ["clean", "-fd"], { cwd });
}

/**
 * Get the current HEAD commit SHA.
 */
export async function getCurrentCommit(cwd: string): Promise<string> {
	const { stdout } = await execFile("git", ["rev-parse", "HEAD"], { cwd });
	return stdout.trim();
}
