import type { SessionStatus } from "@ultracoder/core";

/**
 * Valid state transitions for sessions.
 *
 * 13-state DevOps-integrated model:
 *   spawning → working → pr_open → review_pending → approved → mergeable → merged → archived
 *   with error/recovery branches through ci_failed, changes_requested, merge_conflicts, failed, killed
 *
 * Transitions are encoded as (from, event) → target, so semantically wrong events
 * are rejected even if they would point to an allowed target status.
 */
const TRANSITIONS: Record<SessionStatus, Partial<Record<SessionEvent, SessionStatus>>> = {
	spawning: { start: "working", kill: "killed" },
	working: { open_pr: "pr_open", fail: "failed", kill: "killed" },
	pr_open: {
		request_review: "review_pending",
		ci_fail: "ci_failed",
		conflict: "merge_conflicts",
		kill: "killed",
	},
	review_pending: {
		approve: "approved",
		request_changes: "changes_requested",
		ci_fail: "ci_failed",
		kill: "killed",
	},
	ci_failed: { resolve: "working", kill: "killed", archive: "archived" },
	changes_requested: { resolve: "working", kill: "killed", archive: "archived" },
	merge_conflicts: { resolve: "working", kill: "killed", archive: "archived" },
	approved: {
		ci_pass: "mergeable",
		make_mergeable: "mergeable",
		ci_fail: "ci_failed",
		kill: "killed",
	},
	mergeable: { merge: "merged", conflict: "merge_conflicts", kill: "killed" },
	merged: { archive: "archived" },
	failed: { start: "working", kill: "killed", archive: "archived" },
	killed: { archive: "archived" },
	archived: {},
};

export type SessionEvent =
	| "start"
	| "open_pr"
	| "request_review"
	| "ci_pass"
	| "ci_fail"
	| "approve"
	| "request_changes"
	| "conflict"
	| "resolve"
	| "make_mergeable"
	| "merge"
	| "kill"
	| "archive"
	| "fail";

export interface TransitionResult {
	valid: boolean;
	from: SessionStatus;
	to: SessionStatus;
	event: SessionEvent;
	reason?: string;
}

/**
 * Check if a state transition is valid.
 * Validates the exact (from, event) pair, not just target status.
 */
export function canTransition(from: SessionStatus, event: SessionEvent): TransitionResult {
	const stateTransitions = TRANSITIONS[from];
	const to = stateTransitions?.[event];

	if (to !== undefined) {
		return { valid: true, from, to, event };
	}

	return {
		valid: false,
		from,
		to: "archived", // placeholder for invalid transitions
		event,
		reason: `Cannot transition from '${from}' via '${event}'`,
	};
}

/**
 * Get all valid events from a given state.
 */
export function validEvents(from: SessionStatus): SessionEvent[] {
	const stateTransitions = TRANSITIONS[from] ?? {};
	return Object.keys(stateTransitions) as SessionEvent[];
}
