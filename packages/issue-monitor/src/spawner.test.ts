import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Deps, Logger, Session } from "@ultracoder/core";
import { spawnFixSession } from "./spawner.js";
import type { IssueRecord, AgentAssessment } from "./types.js";

vi.mock("@ultracoder/core", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		runSpawnPipeline: vi.fn().mockResolvedValue({
			workspacePath: "/tmp/ws/sess-1",
			runtimeHandle: { id: "rt-1", pid: 1234 },
		}),
	};
});

function makeLogger(): Logger {
	return {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		child: vi.fn().mockReturnThis(),
	};
}

function makeAssessment(agent: string): AgentAssessment {
	return {
		agent,
		severity: "high",
		effort: "small",
		rootCause: "Missing check",
		proposedFix: "Add guard",
		relatedFiles: ["src/auth.ts"],
		confidence: 0.85,
		completedAt: new Date().toISOString(),
	};
}

function makeRecord(overrides: Partial<IssueRecord> = {}): IssueRecord {
	return {
		issueId: "42",
		issueUrl: "https://github.com/test/repo/issues/42",
		title: "Login crash",
		body: "App crashes on login",
		state: "spawning",
		firstSeenAt: new Date().toISOString(),
		lastCheckedAt: new Date().toISOString(),
		assessments: {
			claude: makeAssessment("claude-opus-4-6"),
			codex: makeAssessment("codex"),
		},
		resolutionPlan: "Fix the null check in src/auth.ts at line 42.",
		...overrides,
	};
}

function makeDeps(): Deps {
	const createdSession: Session = {
		id: "sess-fix-42",
		projectId: "test-project",
		task: "fix issue",
		status: "spawning",
		agentType: "claude-code",
		workspacePath: "/tmp/ws",
		branch: "uc/fix-issue-42",
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		metadata: {},
	};

	return {
		config: {
			projectId: "test-project",
			rootPath: "/tmp/project",
			defaultBranch: "main",
			session: {
				agent: { type: "claude-code", timeout: 3600, env: {} },
				quality: {
					veracity: { enabled: true, tier: "regex" },
					toolPolicy: {
						enabled: true,
						defaultTier: "evaluate",
						evaluateRules: { maxFileSize: 1048576, maxFilesModified: 100, maxSubprocessMs: 300000 },
					},
					gates: { lint: true, test: true, typecheck: true },
					reviewer: { enabled: false },
				},
				maxConcurrent: 4,
				autoResume: true,
				cooldownSeconds: 30,
				reactions: {
					ci_fail: { maxRetries: 2, escalateAfterMs: 1800000 },
					conflict: { maxRetries: 1, escalateAfterMs: 900000 },
					stuck: { maxRetries: 1, escalateAfterMs: 600000 },
				},
			},
			plugins: {},
			pricing: {},
			llm: { endpoints: [], maxRetries: 3, timeoutMs: 120000 },
			storageBackend: "file",
			workspace: { strategy: "worktree" },
			experiments: { presets: {}, mode: "sequential", parallelVariations: 3, defaultMaxIterations: 20, defaultMaxNoImprovement: 5 },
			notifications: { desktop: true, slack: { enabled: false } },
			issueMonitor: {
				enabled: true,
				pollIntervalMs: 60000,
				filter: { state: "open" },
				assessorTimeoutMs: 180000,
				maxConcurrentAssessments: 2,
				maxConcurrentSpawns: 3,
			},
		} as Deps["config"],
		logger: makeLogger(),
		plugins: {
			register: vi.fn(),
			get: vi.fn(),
			getAll: vi.fn().mockReturnValue(new Map()),
			has: vi.fn(),
		} as unknown as Deps["plugins"],
		sessions: {
			create: vi.fn().mockResolvedValue(createdSession),
			get: vi.fn(),
			update: vi.fn(),
			list: vi.fn().mockResolvedValue([]),
			archive: vi.fn(),
			delete: vi.fn(),
		},
		paths: {} as Deps["paths"],
	};
}

describe("spawnFixSession", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("creates a session with correct branch, task, and metadata", async () => {
		const deps = makeDeps();
		const record = makeRecord();

		await spawnFixSession(record, deps, makeLogger());

		expect(deps.sessions.create).toHaveBeenCalledWith(
			expect.objectContaining({
				projectId: "test-project",
				agentType: "claude-code",
				branch: "uc/fix-issue-42",
				metadata: expect.objectContaining({
					issueId: "42",
					issueUrl: "https://github.com/test/repo/issues/42",
					assessments: record.assessments,
					source: "issue-monitor",
				}),
			}),
		);
	});

	it("includes issue number and resolution plan in task description", async () => {
		const deps = makeDeps();
		const record = makeRecord({ resolutionPlan: "Add null check at line 42." });

		await spawnFixSession(record, deps, makeLogger());

		const createCall = vi.mocked(deps.sessions.create).mock.calls[0][0];
		expect(createCall.task).toContain("Fix GitHub issue #42");
		expect(createCall.task).toContain("Login crash");
		expect(createCall.task).toContain("Add null check at line 42.");
		expect(createCall.task).toContain("Fixes #42");
	});

	it("calls runSpawnPipeline with the created session", async () => {
		const deps = makeDeps();
		const { runSpawnPipeline } = await import("@ultracoder/core");

		await spawnFixSession(makeRecord(), deps, makeLogger());

		expect(runSpawnPipeline).toHaveBeenCalledWith(
			expect.objectContaining({
				session: expect.objectContaining({ id: "sess-fix-42" }),
				deps,
			}),
		);
	});

	it("returns the created session ID", async () => {
		const deps = makeDeps();
		const sessionId = await spawnFixSession(makeRecord(), deps, makeLogger());

		expect(sessionId).toBe("sess-fix-42");
	});

	it("throws when record has no resolution plan", async () => {
		const deps = makeDeps();
		const record = makeRecord({ resolutionPlan: undefined });

		await expect(
			spawnFixSession(record, deps, makeLogger()),
		).rejects.toThrow("Issue 42 has no resolution plan");
	});

	it("uses project default agent type from config", async () => {
		const deps = makeDeps();
		(deps.config.session.agent as { type: string }).type = "codex";

		await spawnFixSession(makeRecord(), deps, makeLogger());

		const createCall = vi.mocked(deps.sessions.create).mock.calls[0][0];
		expect(createCall.agentType).toBe("codex");
	});

	it("generates branch name from issue ID", async () => {
		const deps = makeDeps();
		const record = makeRecord({ issueId: "123" });

		await spawnFixSession(record, deps, makeLogger());

		const createCall = vi.mocked(deps.sessions.create).mock.calls[0][0];
		expect(createCall.branch).toBe("uc/fix-issue-123");
	});

	it("propagates runSpawnPipeline errors", async () => {
		const deps = makeDeps();
		const { runSpawnPipeline } = await import("@ultracoder/core");
		vi.mocked(runSpawnPipeline).mockRejectedValueOnce(
			new Error("Max concurrent sessions (10) reached"),
		);

		await expect(
			spawnFixSession(makeRecord(), deps, makeLogger()),
		).rejects.toThrow("Max concurrent sessions (10) reached");
	});
});
