// Re-export from core — the canonical source of truth is now @ultracoder/core
export {
	canTransition,
	SESSION_TRANSITIONS,
	validEvents,
} from "@ultracoder/core";
export type { SessionEvent, TransitionResult } from "@ultracoder/core";
