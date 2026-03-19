// @ultracoder/lifecycle — state machine, reactions, activity detection, auto-resume

export { canTransition, validEvents } from "./state-machine.js";
export type { SessionEvent, TransitionResult } from "./state-machine.js";

export { detectActivity, isStuck } from "./activity-detector.js";
export type { ActivitySummary } from "./activity-detector.js";

export { classifyIntent } from "./intent-classifier.js";
export type { AgentIntent, IntentClassification } from "./intent-classifier.js";

export { evaluateReaction } from "./reactions.js";
export type {
	Reaction,
	ReactionAction,
	ReactionConfig,
	ReactionTrigger,
	TriggerConfig,
	TriggerMeta,
} from "./reactions.js";
export { DEFAULT_REACTION_CONFIG } from "./reactions.js";

export { LifecycleWorker } from "./worker.js";
export type { WorkerConfig } from "./worker.js";

export { handleAutoResume } from "./auto-resume.js";
export type { AutoResumeConfig } from "./auto-resume.js";
