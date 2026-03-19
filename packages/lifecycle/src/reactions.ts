import type { Logger, Session } from "@ultracoder/core";

export type ReactionTrigger = "ci_fail" | "review_requested" | "conflict" | "stuck" | "completed";

export interface Reaction {
	trigger: ReactionTrigger;
	action: ReactionAction;
}

export type ReactionAction =
	| { type: "notify"; message: string }
	| { type: "retry" }
	| { type: "pause" }
	| { type: "resume"; message: string }
	| { type: "kill"; reason: string }
	| { type: "escalate"; to: "human" };

// ─── Escalation Configuration ──────────────────────────────────────

export interface TriggerConfig {
	maxRetries: number;
	escalateAfterMs: number;
}

export interface ReactionConfig {
	ci_fail: TriggerConfig;
	review_requested: TriggerConfig;
	conflict: TriggerConfig;
	stuck: TriggerConfig;
	completed: TriggerConfig;
}

export const DEFAULT_REACTION_CONFIG: ReactionConfig = {
	ci_fail: { maxRetries: 2, escalateAfterMs: 1800000 }, // 30 min
	review_requested: { maxRetries: 0, escalateAfterMs: 0 }, // no escalation
	conflict: { maxRetries: 1, escalateAfterMs: 900000 }, // 15 min
	stuck: { maxRetries: 1, escalateAfterMs: 600000 }, // 10 min
	completed: { maxRetries: 0, escalateAfterMs: 0 }, // no escalation
};

// ─── Trigger Metadata ──────────────────────────────────────────────

export interface TriggerMeta {
	firstDetectedAt?: string; // ISO timestamp
	retryCount?: number;
}

/**
 * Evaluate reactions for a given trigger.
 * Returns the appropriate action based on session state, configuration, and trigger metadata.
 *
 * When `meta` provides retry count or first-detected timestamp, the function checks
 * escalation thresholds defined in `config` (falling back to DEFAULT_REACTION_CONFIG).
 */
export function evaluateReaction(
	trigger: ReactionTrigger,
	session: Session,
	logger: Logger,
	config?: ReactionConfig,
	meta?: TriggerMeta,
): ReactionAction {
	logger.info(`Evaluating reaction for trigger '${trigger}'`, { sessionId: session.id });

	const resolvedConfig = config ?? DEFAULT_REACTION_CONFIG;
	const triggerCfg = resolvedConfig[trigger];

	// Check retry-count escalation
	if (
		meta?.retryCount != null &&
		triggerCfg.maxRetries > 0 &&
		meta.retryCount >= triggerCfg.maxRetries
	) {
		logger.info(
			`Escalating '${trigger}': retryCount ${meta.retryCount} >= maxRetries ${triggerCfg.maxRetries}`,
			{
				sessionId: session.id,
			},
		);
		return { type: "escalate", to: "human" };
	}

	// Check time-based escalation
	if (meta?.firstDetectedAt && triggerCfg.escalateAfterMs > 0) {
		const elapsed = Date.now() - new Date(meta.firstDetectedAt).getTime();
		if (elapsed > triggerCfg.escalateAfterMs) {
			logger.info(
				`Escalating '${trigger}': elapsed ${elapsed}ms > escalateAfterMs ${triggerCfg.escalateAfterMs}`,
				{ sessionId: session.id },
			);
			return { type: "escalate", to: "human" };
		}
	}

	switch (trigger) {
		case "ci_fail":
			return { type: "notify", message: `CI failed for session ${session.id}` };

		case "review_requested":
			return { type: "notify", message: `Review requested for session ${session.id}` };

		case "conflict":
			return { type: "pause" };

		case "stuck":
			return { type: "resume", message: "Agent appears stuck. Resuming with fresh context." };

		case "completed":
			return { type: "notify", message: `Session ${session.id} completed: ${session.task}` };

		default:
			return { type: "escalate", to: "human" };
	}
}
