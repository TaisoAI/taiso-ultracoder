// @ultracoder/core — types, schemas, utilities, paths, logger

// Types & interfaces
export type {
	AgentActivity,
	AgentActivityType,
	AgentCommandOpts,
	AgentConfig,
	AgentPlugin,
	CIStatus,
	CIStatusState,
	Deps,
	LogEntry,
	LogLevel,
	Logger,
	MergeStrategy,
	Notification,
	NotifierPlugin,
	PathResolver,
	Plugin,
	PluginForSlot,
	PluginMeta,
	PluginRegistry,
	PluginSlot,
	ProjectConfig,
	PullRequestOpts,
	PullRequestState,
	PullRequestStatus,
	ReviewOpts,
	ReviewVerdict,
	ReviewVerdictDecision,
	ReviewerPlugin,
	RuntimeHandle,
	RuntimePlugin,
	RuntimeSpawnOpts,
	ScmPlugin,
	Session,
	SessionConfig,
	SessionManager,
	SessionStatus,
	TrackerIssue,
	TrackerIssueOpts,
	TrackerListOpts,
	TrackerPlugin,
	WorkspaceCreateOpts,
	WorkspaceInfo,
	WorkspacePlugin,
} from "./types.js";

export { PLUGIN_SLOTS } from "./types.js";

// Zod schemas
export {
	AgentConfigSchema,
	ExperimentConfigSchema,
	LLMConfigSchema,
	LLMEndpointSchema,
	MetricPresetSchema,
	PluginRefSchema,
	IssueFilterSchema,
	IssueMonitorConfigSchema,
	ProjectConfigSchema,
	QualityConfigSchema,
	SessionConfigSchema,
} from "./schemas.js";

// Utilities
export { atomicWrite, safeRead } from "./util/atomic.js";
export { KVStore } from "./util/kv-store.js";
export { appendJsonl, readJsonl, streamJsonl, tailJsonl } from "./util/jsonl.js";

// Paths
export { createPathResolver, globalConfigPath } from "./paths.js";

// Logger
export { createLogger } from "./logger.js";
export type { LoggerOpts } from "./logger.js";

// Plugin registry
export { DefaultPluginRegistry, loadPlugin } from "./plugin-registry.js";

// Configuration
export { loadConfig, mergeConfig } from "./config.js";

// LLM Router
export { WeightedRouter } from "./llm-router.js";
export type { LLMEndpoint } from "./llm-router.js";

// State machine
export { canTransition, SESSION_TRANSITIONS, validEvents } from "./state-machine.js";
export type { SessionEvent, TransitionResult } from "./state-machine.js";

// Session manager
export { FileSessionManager } from "./session-manager.js";
export { createSessionManager } from "./session-manager-factory.js";
export type { StorageBackend, SessionManagerFactoryOpts } from "./session-manager-factory.js";

// Orchestrator
export { Orchestrator } from "./orchestrator.js";
export type { OrchestratorConfig, OrchestratorCallbacks } from "./orchestrator.js";

// Spawn pipeline
export { runSpawnPipeline } from "./spawn-pipeline.js";
export type { SpawnPipelineOpts, SpawnPipelineResult } from "./spawn-pipeline.js";
