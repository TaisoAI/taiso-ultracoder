import * as fs from "node:fs";
import type { Deps, Logger, Session } from "@ultracoder/core";

export interface RecoveryAction {
	sessionId: string;
	action: "restart" | "archive" | "notify" | "skip";
	reason: string;
}

export interface RecoveryReport {
	scannedCount: number;
	actions: RecoveryAction[];
	dryRun: boolean;
}

/**
 * Recovery system: scan → validate → act → report.
 * Scans for sessions in unhealthy states and takes corrective action.
 */
export async function runRecovery(
	deps: Deps,
	opts?: { dryRun?: boolean },
): Promise<RecoveryReport> {
	const logger = deps.logger.child({ component: "recovery" });
	const dryRun = opts?.dryRun ?? false;
	const sessions = await deps.sessions.list();
	const actions: RecoveryAction[] = [];

	for (const session of sessions) {
		const action = await diagnoseSession(session, logger);
		if (action) {
			actions.push(action);
			if (!dryRun) {
				try {
					await executeRecoveryAction(action, deps, logger);
				} catch (err) {
					logger.error(`Recovery action failed for session '${session.id}'`, {
						action: action.action,
						error: String(err),
					});
				}
			}
		}
	}

	logger.info("Recovery scan complete", {
		scanned: sessions.length,
		actions: actions.length,
		dryRun,
	});

	return {
		scannedCount: sessions.length,
		actions,
		dryRun,
	};
}

async function diagnoseSession(session: Session, logger: Logger): Promise<RecoveryAction | null> {
	// Check for orphaned running sessions (no PID or runtime)
	if (session.status === "working" && !session.pid && !session.runtimeId) {
		return {
			sessionId: session.id,
			action: "archive",
			reason: "Orphaned session: working but no PID or runtime",
		};
	}

	// Check runtime liveness: if session has a PID, verify the process is alive
	if (session.status === "working" && session.pid) {
		const alive = isProcessAlive(session.pid);
		if (!alive) {
			logger.warn(`Runtime dead for session '${session.id}' (PID ${session.pid})`, {
				sessionId: session.id,
				pid: session.pid,
			});
			return {
				sessionId: session.id,
				action: "archive",
				reason: `Orphaned session: PID ${session.pid} is no longer alive`,
			};
		}
	}

	// Check runtime liveness via runtimeId (if no PID but has runtimeId, we can't verify — skip)

	// Check workspace liveness: if session has a workspacePath, verify it exists
	if ((session.status === "working" || session.status === "spawning") && session.workspacePath) {
		const exists = await isDirectoryAccessible(session.workspacePath);
		if (!exists) {
			logger.warn(`Workspace missing for session '${session.id}' (${session.workspacePath})`, {
				sessionId: session.id,
				workspacePath: session.workspacePath,
			});
			return {
				sessionId: session.id,
				action: "archive",
				reason: `Workspace missing: ${session.workspacePath} is not accessible`,
			};
		}
	}

	// Check for very old spawning sessions
	const age = Date.now() - new Date(session.createdAt).getTime();
	const oneHour = 60 * 60 * 1000;

	if (session.status === "spawning" && age > oneHour) {
		return {
			sessionId: session.id,
			action: "archive",
			reason: "Stale spawning session: older than 1 hour",
		};
	}

	// Check for failed sessions that might benefit from retry
	if (session.status === "failed") {
		const raw = session.metadata.retryCount;
		const retryCount = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
		if (retryCount < 3) {
			return {
				sessionId: session.id,
				action: "restart",
				reason: `Failed session: retry ${retryCount + 1}/3`,
			};
		}
		return {
			sessionId: session.id,
			action: "archive",
			reason: "Failed session: max retries exceeded",
		};
	}

	return null;
}

/** Check if a process is alive by sending signal 0. */
function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/** Check if a directory is accessible on disk. */
async function isDirectoryAccessible(dirPath: string): Promise<boolean> {
	try {
		await fs.promises.access(dirPath);
		return true;
	} catch {
		return false;
	}
}

async function executeRecoveryAction(
	action: RecoveryAction,
	deps: Deps,
	logger: Logger,
): Promise<void> {
	logger.info(`Executing recovery: ${action.action}`, {
		sessionId: action.sessionId,
		reason: action.reason,
	});

	switch (action.action) {
		case "archive":
			await deps.sessions.archive(action.sessionId);
			break;
		case "restart":
			await deps.sessions.update(action.sessionId, { status: "spawning" });
			break;
		case "notify":
			// Would trigger notifier plugin
			break;
		case "skip":
			break;
	}
}
