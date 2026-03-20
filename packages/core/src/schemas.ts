import { z } from "zod";

// ─── Agent Configuration ────────────────────────────────────────────
export const AgentConfigSchema = z.object({
	type: z.enum(["claude-code", "codex"]).default("claude-code"),
	model: z.string().optional(),
	maxTokens: z.number().positive().optional(),
	timeout: z.number().positive().default(3600),
	env: z.record(z.string()).default({}),
});

// ─── Plugin Reference ───────────────────────────────────────────────
export const PluginRefSchema = z.object({
	package: z.string(),
	config: z.record(z.unknown()).default({}),
});

// ─── Quality Config ─────────────────────────────────────────────────
export const QualityConfigSchema = z.object({
	veracity: z
		.object({
			enabled: z.boolean().default(true),
			tier: z.enum(["regex", "llm", "both"]).default("regex"),
		})
		.default({}),
	toolPolicy: z
		.object({
			enabled: z.boolean().default(true),
			defaultTier: z.enum(["auto", "evaluate", "human", "blocked"]).default("evaluate"),
			evaluateRules: z
				.object({
					maxFileSize: z.number().positive().default(1048576),
					maxFilesModified: z.number().positive().default(100),
					maxSubprocessMs: z.number().positive().default(300000),
				})
				.default({}),
		})
		.default({}),
	gates: z
		.object({
			lint: z.boolean().default(true),
			test: z.boolean().default(true),
			typecheck: z.boolean().default(true),
		})
		.default({}),
	reviewer: z
		.object({
			enabled: z.boolean().default(false),
			model: z.string().optional(),
		})
		.default({}),
});

// ─── Reaction Escalation Config ────────────────────────────────────
export const TriggerConfigSchema = z.object({
	maxRetries: z.number().nonnegative(),
	escalateAfterMs: z.number().nonnegative(),
});

export const ReactionConfigSchema = z
	.object({
		ci_fail: TriggerConfigSchema.default({ maxRetries: 2, escalateAfterMs: 1800000 }),
		conflict: TriggerConfigSchema.default({ maxRetries: 1, escalateAfterMs: 900000 }),
		stuck: TriggerConfigSchema.default({ maxRetries: 1, escalateAfterMs: 600000 }),
	})
	.default({});

// ─── Session Configuration ──────────────────────────────────────────
export const SessionConfigSchema = z.object({
	agent: AgentConfigSchema.default({}),
	quality: QualityConfigSchema.default({}),
	maxConcurrent: z.number().positive().default(4),
	autoResume: z.boolean().default(true),
	cooldownSeconds: z.number().nonnegative().default(30),
	reactions: ReactionConfigSchema,
});

// ─── Pricing Configuration ──────────────────────────────────────────
export const PricingSchema = z
	.record(
		z.object({
			input: z.number().nonnegative(),
			output: z.number().nonnegative(),
		}),
	)
	.default({
		"claude-sonnet-4-5-20250514": { input: 3.0, output: 15.0 },
		"claude-opus-4-5-20250514": { input: 15.0, output: 75.0 },
		"gpt-4o": { input: 2.5, output: 10.0 },
		o3: { input: 10.0, output: 40.0 },
	});

// ─── LLM Endpoint Configuration ────────────────────────────────────
export const LLMEndpointSchema = z.object({
	url: z.string().url(),
	apiKey: z.string().optional(),
	weight: z.number().positive().default(1),
	models: z.array(z.string()).optional(),
});

export const LLMConfigSchema = z
	.object({
		endpoints: z.array(LLMEndpointSchema).default([]),
		defaultModel: z.string().optional(),
		maxRetries: z.number().nonnegative().default(3),
		timeoutMs: z.number().positive().default(120000),
	})
	.default({});

// ─── Experiment Configuration ───────────────────────────────────────
export const MetricPresetSchema = z.object({
	command: z.string(),
	extract: z.string(),
	direction: z.enum(["up", "down"]),
});

export const ExperimentConfigSchema = z
	.object({
		presets: z.record(MetricPresetSchema).default({}),
		mode: z.enum(["sequential", "parallel", "hybrid"]).default("sequential"),
		parallelVariations: z.number().positive().default(3),
		defaultMaxIterations: z.number().positive().default(20),
		defaultMaxNoImprovement: z.number().positive().default(5),
	})
	.default({});

// ─── Issue Monitor Configuration ───────────────────────────────────
export const IssueFilterSchema = z
	.object({
		labels: z.array(z.string()).optional(),
		excludeLabels: z.array(z.string()).optional(),
		assignee: z.string().optional(),
		query: z.string().optional(),
		state: z.enum(["open", "closed", "all"]).default("open"),
	})
	.default({});

export const IssueMonitorConfigSchema = z
	.object({
		enabled: z.boolean().default(false),
		pollIntervalMs: z.number().positive().default(60_000),
		filter: IssueFilterSchema,
		assessorAgentPath: z.string().optional(),
		assessorTimeoutMs: z.number().positive().default(180_000),
		synthesizerModel: z.string().optional(),
		maxEffort: z.enum(["trivial", "small", "medium", "large"]).optional(),
		maxConcurrentAssessments: z.number().positive().default(2),
		maxConcurrentSpawns: z.number().positive().default(3),
	})
	.default({});

// ─── Project Configuration ──────────────────────────────────────────
export const ProjectConfigSchema = z.object({
	projectId: z.string().min(1),
	rootPath: z.string().min(1),
	defaultBranch: z.string().default("main"),
	session: SessionConfigSchema.default({}),
	plugins: z.record(PluginRefSchema).default({}),
	pricing: PricingSchema,
	llm: LLMConfigSchema,
	storageBackend: z.enum(["file", "sqlite"]).default("file"),
	workspace: z
		.object({
			strategy: z.enum(["worktree", "clone"]).default("worktree"),
			basePath: z.string().optional(),
		})
		.default({}),
	experiments: ExperimentConfigSchema,
	issueMonitor: IssueMonitorConfigSchema,
	notifications: z
		.object({
			desktop: z.boolean().default(true),
			slack: z
				.object({
					enabled: z.boolean().default(false),
					webhook: z.string().optional(),
				})
				.default({}),
		})
		.default({}),
});
