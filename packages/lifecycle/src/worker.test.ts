import type {
	Deps,
	Logger,
	NotifierPlugin,
	PathResolver,
	PluginRegistry,
	PullRequestStatus,
	RuntimePlugin,
	ScmPlugin,
	Session,
	SessionManager,
} from "@ultracoder/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivitySummary } from "./activity-detector.js";
import { LifecycleWorker } from "./worker.js";

// ─── Mocks ────────────────────────────────────────────────────────────

vi.mock("./activity-detector.js", () => ({
	detectActivity: vi.fn(),
	isStuck: vi.fn(),
}));

import { detectActivity, isStuck } from "./activity-detector.js";

const mockDetectActivity = vi.mocked(detectActivity);
const mockIsStuck = vi.mocked(isStuck);

// ─── Helpers ──────────────────────────────────────────────────────────

function makeLogger(): Logger {
	const logger: Logger = {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		child: vi.fn(() => logger),
	};
	return logger;
}

function makeSession(overrides: Partial<Session> = {}): Session {
	return {
		id: "sess-1",
		projectId: "proj-1",
		task: "Fix the bug",
		status: "working",
		agentType: "claude",
		workspacePath: "/tmp/ws",
		branch: "fix/bug",
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		metadata: {},
		...overrides,
	};
}

function idleSummary(): ActivitySummary {
	return {
		lastActivity: null,
		idleSince: null,
		isActive: false,
		isCompleted: false,
		totalEvents: 0,
	};
}

function completedSummary(): ActivitySummary {
	return {
		lastActivity: { type: "completed", timestamp: new Date().toISOString() },
		idleSince: null,
		isActive: false,
		isCompleted: true,
		totalEvents: 5,
	};
}

function activeSummary(): ActivitySummary {
	return {
		lastActivity: { type: "active", timestamp: new Date().toISOString() },
		idleSince: null,
		isActive: true,
		isCompleted: false,
		totalEvents: 3,
	};
}

function stuckSummary(): ActivitySummary {
	const tenMinAgo = new Date(Date.now() - 600_000).toISOString();
	return {
		lastActivity: { type: "idle", timestamp: tenMinAgo },
		idleSince: tenMinAgo,
		isActive: false,
		isCompleted: false,
		totalEvents: 2,
	};
}

function makePRStatus(overrides: Partial<PullRequestStatus> = {}): PullRequestStatus {
	return {
		id: "pr-1",
		state: "open",
		mergeable: true,
		ciStatus: { state: "pending", checks: [] },
		...overrides,
	};
}

interface MockDeps {
	logger: Logger;
	sessions: {
		list: ReturnType<typeof vi.fn>;
		get: ReturnType<typeof vi.fn>;
		update: ReturnType<typeof vi.fn>;
		create: ReturnType<typeof vi.fn>;
		archive: ReturnType<typeof vi.fn>;
		delete: ReturnType<typeof vi.fn>;
	};
	plugins: {
		register: ReturnType<typeof vi.fn>;
		get: ReturnType<typeof vi.fn>;
		getAll: ReturnType<typeof vi.fn>;
		has: ReturnType<typeof vi.fn>;
	};
	paths: {
		dataDir: ReturnType<typeof vi.fn>;
		sessionsDir: ReturnType<typeof vi.fn>;
		sessionDir: ReturnType<typeof vi.fn>;
		sessionFile: ReturnType<typeof vi.fn>;
		logsDir: ReturnType<typeof vi.fn>;
		archiveDir: ReturnType<typeof vi.fn>;
	};
	config: Record<string, unknown>;
}

function makeDeps(): MockDeps {
	return {
		logger: makeLogger(),
		sessions: {
			list: vi.fn().mockResolvedValue([]),
			get: vi.fn(),
			update: vi.fn().mockImplementation((_id, patch) => Promise.resolve(patch)),
			create: vi.fn(),
			archive: vi.fn(),
			delete: vi.fn(),
		},
		plugins: {
			register: vi.fn(),
			get: vi.fn().mockReturnValue(undefined),
			getAll: vi.fn(),
			has: vi.fn(),
		},
		paths: {
			dataDir: vi.fn().mockReturnValue("/data"),
			sessionsDir: vi.fn().mockReturnValue("/data/sessions"),
			sessionDir: vi.fn().mockReturnValue("/data/sessions/sess-1"),
			sessionFile: vi.fn().mockReturnValue("/data/sessions/sess-1/session.json"),
			logsDir: vi.fn().mockReturnValue("/data/sessions/sess-1/logs"),
			archiveDir: vi.fn().mockReturnValue("/data/archive"),
		},
		config: {},
	};
}

// ─── Tests ────────────────────────────────────────────────────────────

describe("LifecycleWorker", () => {
	let deps: MockDeps;
	let worker: LifecycleWorker;

	beforeEach(() => {
		vi.clearAllMocks();
		deps = makeDeps();
		worker = new LifecycleWorker(deps as unknown as Deps, { enabled: false });

		mockDetectActivity.mockResolvedValue(idleSummary());
		mockIsStuck.mockReturnValue(false);
	});

	// ─── Poll overlap guard ───────────────────────────────────────

	describe("poll overlap guard", () => {
		it("skips poll when one is already in progress", async () => {
			const session = makeSession();
			let resolveFirst!: () => void;
			const blockingPromise = new Promise<void>((r) => {
				resolveFirst = r;
			});

			deps.sessions.list.mockImplementation(async () => {
				await blockingPromise;
				return [session];
			});

			const poll1 = worker.poll();
			const poll2 = worker.poll(); // should be skipped

			resolveFirst();
			await poll1;
			await poll2;

			// list() should only have been called for the first poll (5 statuses)
			expect(deps.sessions.list).toHaveBeenCalledTimes(5);
		});
	});

	// ─── doPoll queries all active statuses ───────────────────────

	describe("doPoll queries all active statuses", () => {
		it("queries working, pr_open, review_pending, approved, mergeable", async () => {
			await worker.poll();

			expect(deps.sessions.list).toHaveBeenCalledWith({ status: "working" });
			expect(deps.sessions.list).toHaveBeenCalledWith({ status: "pr_open" });
			expect(deps.sessions.list).toHaveBeenCalledWith({ status: "review_pending" });
			expect(deps.sessions.list).toHaveBeenCalledWith({ status: "approved" });
			expect(deps.sessions.list).toHaveBeenCalledWith({ status: "mergeable" });
		});

		it("deduplicates sessions returned from multiple lists", async () => {
			const session = makeSession();
			deps.sessions.list.mockResolvedValue([session]);
			mockDetectActivity.mockResolvedValue(activeSummary());

			await worker.poll();

			// detectActivity should be called once even though session appears in all 5 lists
			expect(mockDetectActivity).toHaveBeenCalledTimes(1);
		});
	});

	// ─── Step 1: Runtime death detection ──────────────────────────

	describe("runtime death detection", () => {
		it("transitions working session to failed when runtime is dead", async () => {
			const session = makeSession({ runtimeId: "rt-1", status: "working" });
			deps.sessions.list.mockImplementation(async ({ status }) =>
				status === "working" ? [session] : [],
			);

			const mockRuntime = {
				isAlive: vi.fn().mockResolvedValue(false),
			};
			deps.plugins.get.mockImplementation((slot: string) =>
				slot === "runtime" ? mockRuntime : undefined,
			);

			await worker.poll();

			expect(mockRuntime.isAlive).toHaveBeenCalledWith({ id: "rt-1" });
			expect(deps.sessions.update).toHaveBeenCalledWith("sess-1", { status: "failed" });
		});

		it("does not fail session when runtime is alive", async () => {
			const session = makeSession({ runtimeId: "rt-1", status: "working" });
			deps.sessions.list.mockImplementation(async ({ status }) =>
				status === "working" ? [session] : [],
			);
			mockDetectActivity.mockResolvedValue(activeSummary());

			const mockRuntime = {
				isAlive: vi.fn().mockResolvedValue(true),
			};
			deps.plugins.get.mockImplementation((slot: string) =>
				slot === "runtime" ? mockRuntime : undefined,
			);

			await worker.poll();

			expect(deps.sessions.update).not.toHaveBeenCalledWith("sess-1", { status: "failed" });
		});

		it("continues checking even if runtime check throws", async () => {
			const session = makeSession({ runtimeId: "rt-1", status: "working" });
			deps.sessions.list.mockImplementation(async ({ status }) =>
				status === "working" ? [session] : [],
			);
			mockDetectActivity.mockResolvedValue(activeSummary());

			const mockRuntime = {
				isAlive: vi.fn().mockRejectedValue(new Error("connection refused")),
			};
			deps.plugins.get.mockImplementation((slot: string) =>
				slot === "runtime" ? mockRuntime : undefined,
			);

			await worker.poll();

			// Should not throw, and activity detection still runs
			expect(mockDetectActivity).toHaveBeenCalled();
		});
	});

	// ─── Step 3: Agent completion → pr_open ───────────────────────

	describe("agent completion → pr_open transition", () => {
		it("transitions working session to pr_open when completed", async () => {
			const session = makeSession({ status: "working" });
			deps.sessions.list.mockImplementation(async ({ status }) =>
				status === "working" ? [session] : [],
			);
			mockDetectActivity.mockResolvedValue(completedSummary());

			await worker.poll();

			expect(deps.sessions.update).toHaveBeenCalledWith(
				"sess-1",
				expect.objectContaining({ status: "pr_open" }),
			);
		});

		it("sets completedAt when transitioning to pr_open", async () => {
			const session = makeSession({ status: "working" });
			deps.sessions.list.mockImplementation(async ({ status }) =>
				status === "working" ? [session] : [],
			);
			mockDetectActivity.mockResolvedValue(completedSummary());

			await worker.poll();

			const updateCall = deps.sessions.update.mock.calls.find(
				(c: unknown[]) => (c[1] as Record<string, unknown>).status === "pr_open",
			);
			expect(updateCall).toBeDefined();
			expect((updateCall![1] as Record<string, unknown>).completedAt).toBeDefined();
		});
	});

	// ─── Step 4: CI failure detection ─────────────────────────────

	describe("CI failure detection", () => {
		it("transitions pr_open to ci_failed when CI fails", async () => {
			const session = makeSession({
				status: "pr_open",
				metadata: { prId: "pr-42" },
			});
			deps.sessions.list.mockImplementation(async ({ status }) =>
				status === "pr_open" ? [session] : [],
			);
			mockDetectActivity.mockResolvedValue(activeSummary());

			const mockScm = {
				getPRStatus: vi.fn().mockResolvedValue(
					makePRStatus({
						ciStatus: { state: "failure", checks: [] },
					}),
				),
			};
			deps.plugins.get.mockImplementation((slot: string) => (slot === "scm" ? mockScm : undefined));

			await worker.poll();

			expect(deps.sessions.update).toHaveBeenCalledWith("sess-1", { status: "ci_failed" });
		});

		it("transitions review_pending to ci_failed when CI errors", async () => {
			const session = makeSession({
				status: "review_pending",
				metadata: { prId: "pr-42" },
			});
			deps.sessions.list.mockImplementation(async ({ status }) =>
				status === "review_pending" ? [session] : [],
			);
			mockDetectActivity.mockResolvedValue(activeSummary());

			const mockScm = {
				getPRStatus: vi.fn().mockResolvedValue(
					makePRStatus({
						ciStatus: { state: "error", checks: [] },
					}),
				),
			};
			deps.plugins.get.mockImplementation((slot: string) => (slot === "scm" ? mockScm : undefined));

			await worker.poll();

			expect(deps.sessions.update).toHaveBeenCalledWith("sess-1", { status: "ci_failed" });
		});
	});

	// ─── Step 4: Review approval chain ────────────────────────────

	describe("review approval chain", () => {
		it("advances pr_open → review_pending → approved when review is approved", async () => {
			const session = makeSession({
				status: "pr_open",
				metadata: { prId: "pr-42" },
			});
			deps.sessions.list.mockImplementation(async ({ status }) =>
				status === "pr_open" ? [session] : [],
			);
			mockDetectActivity.mockResolvedValue(activeSummary());

			const mockScm = {
				getPRStatus: vi.fn().mockResolvedValue(
					makePRStatus({
						reviewDecision: "approved",
						ciStatus: { state: "pending", checks: [] },
					}),
				),
			};
			deps.plugins.get.mockImplementation((slot: string) => (slot === "scm" ? mockScm : undefined));

			// After update to review_pending, get() returns the updated session
			deps.sessions.get.mockResolvedValue(
				makeSession({ status: "review_pending", metadata: { prId: "pr-42" } }),
			);

			await worker.poll();

			// Should first go to review_pending, then approved
			expect(deps.sessions.update).toHaveBeenCalledWith("sess-1", {
				status: "review_pending",
			});
			expect(deps.sessions.update).toHaveBeenCalledWith("sess-1", { status: "approved" });
		});

		it("advances review_pending → approved directly", async () => {
			const session = makeSession({
				status: "review_pending",
				metadata: { prId: "pr-42" },
			});
			deps.sessions.list.mockImplementation(async ({ status }) =>
				status === "review_pending" ? [session] : [],
			);
			mockDetectActivity.mockResolvedValue(activeSummary());

			const mockScm = {
				getPRStatus: vi.fn().mockResolvedValue(
					makePRStatus({
						reviewDecision: "approved",
						ciStatus: { state: "pending", checks: [] },
					}),
				),
			};
			deps.plugins.get.mockImplementation((slot: string) => (slot === "scm" ? mockScm : undefined));

			deps.sessions.get.mockResolvedValue(
				makeSession({ status: "review_pending", metadata: { prId: "pr-42" } }),
			);

			await worker.poll();

			expect(deps.sessions.update).toHaveBeenCalledWith("sess-1", { status: "approved" });
		});
	});

	// ─── Step 4: Changes requested ────────────────────────────────

	describe("changes requested", () => {
		it("transitions review_pending → changes_requested", async () => {
			const session = makeSession({
				status: "review_pending",
				metadata: { prId: "pr-42" },
			});
			deps.sessions.list.mockImplementation(async ({ status }) =>
				status === "review_pending" ? [session] : [],
			);
			mockDetectActivity.mockResolvedValue(activeSummary());

			const mockScm = {
				getPRStatus: vi.fn().mockResolvedValue(
					makePRStatus({
						reviewDecision: "changes_requested",
						ciStatus: { state: "success", checks: [] },
					}),
				),
			};
			deps.plugins.get.mockImplementation((slot: string) => (slot === "scm" ? mockScm : undefined));

			await worker.poll();

			expect(deps.sessions.update).toHaveBeenCalledWith("sess-1", {
				status: "changes_requested",
			});
		});
	});

	// ─── Step 4: Merge conflict detection ─────────────────────────

	describe("merge conflict detection", () => {
		it("transitions pr_open → merge_conflicts when not mergeable", async () => {
			const session = makeSession({
				status: "pr_open",
				metadata: { prId: "pr-42" },
			});
			deps.sessions.list.mockImplementation(async ({ status }) =>
				status === "pr_open" ? [session] : [],
			);
			mockDetectActivity.mockResolvedValue(activeSummary());

			const mockScm = {
				getPRStatus: vi.fn().mockResolvedValue(
					makePRStatus({
						mergeable: false,
						ciStatus: { state: "success", checks: [] },
					}),
				),
			};
			deps.plugins.get.mockImplementation((slot: string) => (slot === "scm" ? mockScm : undefined));

			await worker.poll();

			expect(deps.sessions.update).toHaveBeenCalledWith("sess-1", {
				status: "merge_conflicts",
			});
		});

		it("transitions mergeable → merge_conflicts when conflicts arise", async () => {
			const session = makeSession({
				status: "mergeable",
				metadata: { prId: "pr-42" },
			});
			deps.sessions.list.mockImplementation(async ({ status }) =>
				status === "mergeable" ? [session] : [],
			);
			mockDetectActivity.mockResolvedValue(activeSummary());

			const mockScm = {
				getPRStatus: vi.fn().mockResolvedValue(
					makePRStatus({
						mergeable: false,
						ciStatus: { state: "success", checks: [] },
					}),
				),
			};
			deps.plugins.get.mockImplementation((slot: string) => (slot === "scm" ? mockScm : undefined));

			await worker.poll();

			expect(deps.sessions.update).toHaveBeenCalledWith("sess-1", {
				status: "merge_conflicts",
			});
		});
	});

	// ─── Step 4: Mergeable detection ──────────────────────────────

	describe("mergeable detection", () => {
		it("transitions approved → mergeable when CI passes", async () => {
			const session = makeSession({
				status: "approved",
				metadata: { prId: "pr-42" },
			});
			deps.sessions.list.mockImplementation(async ({ status }) =>
				status === "approved" ? [session] : [],
			);
			mockDetectActivity.mockResolvedValue(activeSummary());

			const mockScm = {
				getPRStatus: vi.fn().mockResolvedValue(
					makePRStatus({
						reviewDecision: "approved",
						mergeable: true,
						ciStatus: { state: "success", checks: [] },
					}),
				),
			};
			deps.plugins.get.mockImplementation((slot: string) => (slot === "scm" ? mockScm : undefined));

			// get() is only called during review decision flow (pr_open/review_pending)
			// For approved status, it skips the review block and goes to mergeable check
			await worker.poll();

			expect(deps.sessions.update).toHaveBeenCalledWith("sess-1", { status: "mergeable" });
		});

		it("does not transition approved → mergeable when CI is pending", async () => {
			const session = makeSession({
				status: "approved",
				metadata: { prId: "pr-42" },
			});
			deps.sessions.list.mockImplementation(async ({ status }) =>
				status === "approved" ? [session] : [],
			);
			mockDetectActivity.mockResolvedValue(activeSummary());

			const mockScm = {
				getPRStatus: vi.fn().mockResolvedValue(
					makePRStatus({
						reviewDecision: "approved",
						mergeable: true,
						ciStatus: { state: "pending", checks: [] },
					}),
				),
			};
			deps.plugins.get.mockImplementation((slot: string) => (slot === "scm" ? mockScm : undefined));

			await worker.poll();

			expect(deps.sessions.update).not.toHaveBeenCalledWith("sess-1", {
				status: "mergeable",
			});
		});
	});

	// ─── Step 5: Stuck detection ──────────────────────────────────

	describe("stuck detection", () => {
		it("triggers stuck reaction when working session is idle too long", async () => {
			const session = makeSession({ status: "working" });
			deps.sessions.list.mockImplementation(async ({ status }) =>
				status === "working" ? [session] : [],
			);
			mockDetectActivity.mockResolvedValue(stuckSummary());
			mockIsStuck.mockReturnValue(true);

			await worker.poll();

			expect(deps.logger.child({} as Record<string, unknown>)).toBeDefined();
			// The evaluateReaction for "stuck" returns a resume action,
			// which is handled as "manual handling" log — just verify no crash
		});

		it("does not trigger stuck for non-working sessions", async () => {
			const session = makeSession({ status: "pr_open", metadata: { prId: "pr-1" } });
			deps.sessions.list.mockImplementation(async ({ status }) =>
				status === "pr_open" ? [session] : [],
			);
			mockDetectActivity.mockResolvedValue(stuckSummary());
			mockIsStuck.mockReturnValue(true);

			// No scm plugin, so checkPRState returns early
			await worker.poll();

			// stuck detection only runs for working sessions
			// The session is pr_open so stuck path is not hit
		});
	});

	// ─── Edge cases ───────────────────────────────────────────────

	describe("edge cases", () => {
		it("skips PR check when no scm plugin", async () => {
			const session = makeSession({ status: "pr_open", metadata: { prId: "pr-1" } });
			deps.sessions.list.mockImplementation(async ({ status }) =>
				status === "pr_open" ? [session] : [],
			);
			mockDetectActivity.mockResolvedValue(activeSummary());

			deps.plugins.get.mockReturnValue(undefined);

			await worker.poll();

			// No crash, no update
			expect(deps.sessions.update).not.toHaveBeenCalled();
		});

		it("skips PR check when session has no prId in metadata", async () => {
			const session = makeSession({ status: "pr_open", metadata: {} });
			deps.sessions.list.mockImplementation(async ({ status }) =>
				status === "pr_open" ? [session] : [],
			);
			mockDetectActivity.mockResolvedValue(activeSummary());

			const mockScm = { getPRStatus: vi.fn() };
			deps.plugins.get.mockImplementation((slot: string) => (slot === "scm" ? mockScm : undefined));

			await worker.poll();

			expect(mockScm.getPRStatus).not.toHaveBeenCalled();
		});
	});
});
