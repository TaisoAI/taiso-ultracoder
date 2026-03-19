import type { Deps, Logger, Session } from "@ultracoder/core";
import { canTransition } from "./state-machine.js";

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

	// Update session with incremented retry count
	await deps.sessions.update(session.id, {
		status: "working",
		metadata: {
			...fresh.metadata,
			retryCount: freshRetryCount + 1,
			lastResumeAt: new Date().toISOString(),
		},
	});

	logger.info("Session auto-resumed", { retryCount: retryCount + 1 });
	return true;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
