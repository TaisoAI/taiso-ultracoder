import { describe, expect, it, vi } from "vitest";
import { runSpawnPipeline } from "./spawn-pipeline.js";
import type {
	AgentPlugin,
	Deps,
	Logger,
	RuntimeHandle,
	RuntimePlugin,
	Session,
	SessionManager,
	WorkspacePlugin,
} from "./types.js";

function mockLogger(): Logger {
	return {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		child: vi.fn().mockReturnThis(),
	};
}

function stubSession(overrides: Partial<Session> = {}): Session {
	return {
		id: "sess-1",
		projectId: "proj-1",
		task: "do stuff",
		status: "spawning",
		agentType: "claude-code",
		workspacePath: "/tmp/ws",
		branch: "uc/sess-1",
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		metadata: {},
		...overrides,
	};
}

function stubDeps(opts: {
	logger: Logger;
	activeSessions?: Session[];
	maxConcurrentSessions?: number;
}): Deps {
	const { logger, activeSessions = [], maxConcurrentSessions = 10 } = opts;

	const sessions: SessionManager = {
		create: vi.fn(),
		get: vi.fn(),
		update: vi.fn().mockImplementation((_id, patch) =>
			Promise.resolve({ ...stubSession(), ...patch }),
		),
		transition: vi.fn(),
		list: vi.fn().mockResolvedValue(activeSessions),
		archive: vi.fn(),
		delete: vi.fn(),
	};

	const workspacePlugin: WorkspacePlugin = {
		meta: { name: "workspace-stub", slot: "workspace", version: "0.0.1" },
		create: vi.fn().mockResolvedValue({
			path: "/tmp/ws/sess-1",
			branch: "uc/sess-1",
			isTemporary: true,
		}),
		cleanup: vi.fn(),
	};

	const agentPlugin: AgentPlugin = {
		meta: { name: "agent-stub", slot: "agent", version: "0.0.1" },
		buildCommand: vi.fn().mockReturnValue({
			command: "echo",
			args: ["hello"],
		}),
		parseActivity: vi.fn().mockReturnValue(null),
	};

	const runtimeHandle: RuntimeHandle = { id: "rt-1", pid: 1234 };
	const runtimePlugin: RuntimePlugin = {
		meta: { name: "runtime-stub", slot: "runtime", version: "0.0.1" },
		spawn: vi.fn().mockResolvedValue(runtimeHandle),
		kill: vi.fn(),
		isAlive: vi.fn().mockResolvedValue(true),
		sendInput: vi.fn(),
	};

	const pluginsMap = new Map<string, unknown>([
		["workspace", workspacePlugin],
		["agent", agentPlugin],
		["runtime", runtimePlugin],
	]);

	return {
		config: {
			projectId: "proj-1",
			rootPath: "/tmp/project",
			defaultBranch: "main",
			session: {
				agent: { type: "claude-code", timeout: 3600, env: {} },
				quality: {
					veracity: { enabled: true, tier: "regex" },
					toolPolicy: {
						enabled: true,
						defaultTier: "evaluate",
						evaluateRules: {
							maxFileSize: 1048576,
							maxFilesModified: 100,
							maxSubprocessMs: 300000,
						},
					},
					gates: { lint: true, test: true, typecheck: true },
					reviewer: { enabled: false },
				},
				maxConcurrent: 4,
				maxConcurrentSessions,
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
			trustedPlugins: [],
			storageBackend: "file",
			workspace: { strategy: "worktree" },
			experiments: {
				presets: {},
				mode: "sequential",
				parallelVariations: 3,
				defaultMaxIterations: 20,
				defaultMaxNoImprovement: 5,
			},
			issueMonitor: {
				enabled: false,
				pollIntervalMs: 60000,
				filter: { state: "open" },
				assessorTimeoutMs: 180000,
				maxConcurrentAssessments: 2,
				maxConcurrentSpawns: 3,
			},
			notifications: { desktop: true, slack: { enabled: false } },
		} as Deps["config"],
		logger,
		plugins: {
			register: vi.fn(),
			get: (slot: string) => pluginsMap.get(slot),
			getAll: () => pluginsMap as never,
			has: (slot: string) => pluginsMap.has(slot),
		} as unknown as Deps["plugins"],
		sessions,
		paths: {} as Deps["paths"],
	};
}

describe("runSpawnPipeline — maxConcurrentSessions", () => {
	it("proceeds when active sessions < max", async () => {
		const logger = mockLogger();
		const session = stubSession();
		const deps = stubDeps({
			logger,
			activeSessions: [stubSession({ id: "existing-1" })],
			maxConcurrentSessions: 5,
		});

		const result = await runSpawnPipeline({
			session,
			task: "implement feature",
			deps,
			logger,
		});

		// Should have called sessions.list to check active count
		expect(deps.sessions.list).toHaveBeenCalledWith({
			status: ["spawning", "working"],
		});
		// Pipeline should complete successfully
		expect(result.workspacePath).toBe("/tmp/ws/sess-1");
		expect(result.runtimeHandle).toBeDefined();
	});

	it("excludes current session from concurrency count", async () => {
		const logger = mockLogger();
		const session = stubSession({ id: "sess-1" });
		// Active list includes the session itself (already created by caller)
		const activeSessions = [
			stubSession({ id: "sess-1", status: "spawning" }),
		];
		const deps = stubDeps({
			logger,
			activeSessions,
			maxConcurrentSessions: 1,
		});

		// Should succeed — the only active session is the one being spawned
		const result = await runSpawnPipeline({
			session,
			task: "implement feature",
			deps,
			logger,
		});

		expect(result.runtimeHandle).toBeDefined();
	});

	it("sets session to failed when concurrency limit hit", async () => {
		const logger = mockLogger();
		const session = stubSession();
		const activeSessions = [
			stubSession({ id: "other-1", status: "working" }),
		];
		const deps = stubDeps({
			logger,
			activeSessions,
			maxConcurrentSessions: 1,
		});

		await expect(
			runSpawnPipeline({ session, task: "task", deps, logger }),
		).rejects.toThrow("Max concurrent sessions (1) reached");

		expect(deps.sessions.update).toHaveBeenCalledWith("sess-1", { status: "failed" });
	});

	it("throws when active sessions >= max", async () => {
		const logger = mockLogger();
		const session = stubSession();
		const activeSessions = [
			stubSession({ id: "s1", status: "spawning" }),
			stubSession({ id: "s2", status: "working" }),
			stubSession({ id: "s3", status: "working" }),
		];
		const deps = stubDeps({
			logger,
			activeSessions,
			maxConcurrentSessions: 3,
		});

		await expect(
			runSpawnPipeline({
				session,
				task: "implement feature",
				deps,
				logger,
			}),
		).rejects.toThrow("Max concurrent sessions (3) reached");

		// Should have logged a warning
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining("Max concurrent sessions (3) reached"),
			expect.objectContaining({ activeCount: 3, maxConcurrent: 3 }),
		);
	});
});
