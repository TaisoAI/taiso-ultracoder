import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Deps, Logger, PathResolver, TrackerIssue, TrackerPlugin } from "@ultracoder/core";
import { IssueMonitor } from "./monitor.js";
import type { IssueMonitorConfig } from "./types.js";

// Mock child_process so assessor doesn't try to run actual agent binaries
vi.mock("node:child_process", () => ({
	execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
		if (cb) {
			// Return a valid JSON assessment
			const response = JSON.stringify({
				severity: "medium",
				effort: "small",
				rootCause: "Test root cause",
				proposedFix: "Test fix",
				relatedFiles: ["src/test.ts"],
				confidence: 0.8,
			});
			cb(null, response, "");
		}
		return { pid: 1234 };
	}),
}));

function createMockLogger(): Logger {
	return {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		child: vi.fn().mockReturnThis(),
	};
}

function createMockTracker(issues: TrackerIssue[]): TrackerPlugin {
	return {
		meta: { name: "test-tracker", slot: "tracker", version: "0.0.1" },
		createIssue: vi.fn().mockResolvedValue("1"),
		updateIssue: vi.fn().mockResolvedValue(undefined),
		getIssue: vi.fn().mockImplementation(async (id: string) => {
			const issue = issues.find((i) => i.id === id);
			if (!issue) throw new Error(`Issue ${id} not found`);
			return issue;
		}),
		listIssues: vi.fn().mockResolvedValue(issues),
		addComment: vi.fn().mockResolvedValue("comment-1"),
	};
}

describe("IssueMonitor", () => {
	let tmpDir: string;
	let logger: Logger;

	beforeEach(async () => {
		tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "monitor-"));
		logger = createMockLogger();
	});

	afterEach(async () => {
		await fs.promises.rm(tmpDir, { recursive: true, force: true });
	});

	function makeDeps(tracker?: TrackerPlugin): Deps {
		const plugins = {
			register: vi.fn(),
			get: vi.fn().mockImplementation((slot: string) => {
				if (slot === "tracker") return tracker;
				return undefined;
			}),
			getAll: vi.fn().mockReturnValue(new Map()),
			has: vi.fn().mockImplementation((slot: string) => slot === "tracker" && !!tracker),
		};

		const paths: PathResolver = {
			dataDir: () => tmpDir,
			sessionsDir: () => path.join(tmpDir, "sessions"),
			sessionDir: (id: string) => path.join(tmpDir, "sessions", id),
			sessionFile: (id: string) => path.join(tmpDir, "sessions", id, "session.json"),
			logsDir: (id: string) => path.join(tmpDir, "sessions", id, "logs"),
			archiveDir: () => path.join(tmpDir, "archive"),
			issuesDir: () => path.join(tmpDir, "issues"),
		};

		return {
			config: {
				projectId: "test-project",
				rootPath: "/tmp/test",
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
			logger,
			plugins,
			sessions: {
				create: vi.fn().mockResolvedValue({ id: "sess-1", status: "spawning" }),
				get: vi.fn(),
				update: vi.fn(),
				list: vi.fn().mockResolvedValue([]),
				archive: vi.fn(),
				delete: vi.fn(),
			},
			paths,
		};
	}

	it("skips poll when disabled", async () => {
		const config: IssueMonitorConfig = {
			enabled: false,
			pollIntervalMs: 60000,
			filter: { state: "open" },
			assessorTimeoutMs: 180000,
			maxConcurrentAssessments: 2,
			maxConcurrentSpawns: 3,
		};
		const deps = makeDeps();
		const monitor = new IssueMonitor(deps, config);
		await monitor.init();
		await monitor.poll();

		// Should not have tried to get tracker
		expect(deps.plugins.get).not.toHaveBeenCalled();
	});

	it("warns when tracker has no listIssues", async () => {
		const tracker: TrackerPlugin = {
			meta: { name: "basic-tracker", slot: "tracker", version: "0.0.1" },
			createIssue: vi.fn().mockResolvedValue("1"),
			updateIssue: vi.fn(),
			getIssue: vi.fn(),
			// No listIssues!
		};
		const config: IssueMonitorConfig = {
			enabled: true,
			pollIntervalMs: 60000,
			filter: { state: "open" },
			assessorTimeoutMs: 180000,
			maxConcurrentAssessments: 2,
			maxConcurrentSpawns: 3,
		};
		const deps = makeDeps(tracker);
		const monitor = new IssueMonitor(deps, config);
		await monitor.init();
		await monitor.poll();

		expect(logger.warn).toHaveBeenCalledWith(
			"Tracker plugin does not support listIssues — skipping poll",
		);
	});

	it("discovers new issues and records them", async () => {
		const issues: TrackerIssue[] = [
			{
				id: "10",
				title: "Bug: crash on startup",
				body: "The app crashes when...",
				state: "open",
				url: "https://github.com/test/repo/issues/10",
				labels: ["bug"],
			},
		];
		const tracker = createMockTracker(issues);
		const config: IssueMonitorConfig = {
			enabled: true,
			pollIntervalMs: 60000,
			filter: { state: "open" },
			assessorTimeoutMs: 180000,
			maxConcurrentAssessments: 2,
			maxConcurrentSpawns: 3,
		};
		const deps = makeDeps(tracker);
		const monitor = new IssueMonitor(deps, config);
		await monitor.init();

		// Poll will discover the issue and try to assess it.
		// Assessment will fail (no agent binary), but the issue should be recorded.
		await monitor.poll();

		const records = await monitor.getRecords();
		expect(records.length).toBe(1);
		expect(records[0].issueId).toBe("10");
		expect(records[0].title).toBe("Bug: crash on startup");
	});

	it("filters out excluded labels", async () => {
		const issues: TrackerIssue[] = [
			{
				id: "11",
				title: "Not a bug",
				body: "This is fine",
				state: "open",
				url: "https://github.com/test/repo/issues/11",
				labels: ["wontfix"],
			},
			{
				id: "12",
				title: "Real bug",
				body: "This is broken",
				state: "open",
				url: "https://github.com/test/repo/issues/12",
				labels: ["bug"],
			},
		];
		const tracker = createMockTracker(issues);
		const config: IssueMonitorConfig = {
			enabled: true,
			pollIntervalMs: 60000,
			filter: { state: "open", excludeLabels: ["wontfix"] },
			assessorTimeoutMs: 180000,
			maxConcurrentAssessments: 2,
			maxConcurrentSpawns: 3,
		};
		const deps = makeDeps(tracker);
		const monitor = new IssueMonitor(deps, config);
		await monitor.init();

		await monitor.poll();

		const records = await monitor.getRecords();
		// Only the non-wontfix issue should be tracked
		expect(records.length).toBe(1);
		expect(records[0].issueId).toBe("12");
	});

	it("does not re-process already tracked issues", async () => {
		const issues: TrackerIssue[] = [
			{
				id: "10",
				title: "Bug",
				body: "Broken",
				state: "open",
				url: "https://github.com/test/repo/issues/10",
			},
		];
		const tracker = createMockTracker(issues);
		const config: IssueMonitorConfig = {
			enabled: true,
			pollIntervalMs: 60000,
			filter: { state: "open" },
			assessorTimeoutMs: 180000,
			maxConcurrentAssessments: 2,
			maxConcurrentSpawns: 3,
		};
		const deps = makeDeps(tracker);
		const monitor = new IssueMonitor(deps, config);
		await monitor.init();

		// First poll
		await monitor.poll();
		const records1 = await monitor.getRecords();
		expect(records1.length).toBe(1);

		// Second poll — should not add duplicate
		await monitor.poll();
		const records2 = await monitor.getRecords();
		expect(records2.length).toBe(1);
	});

	it("skips poll when another poll is already in progress", async () => {
		const issues: TrackerIssue[] = [
			{
				id: "10",
				title: "Bug",
				body: "Broken",
				state: "open",
				url: "https://github.com/test/repo/issues/10",
			},
		];
		const tracker = createMockTracker(issues);
		const config: IssueMonitorConfig = {
			enabled: true,
			pollIntervalMs: 60000,
			filter: { state: "open" },
			assessorTimeoutMs: 180000,
			maxConcurrentAssessments: 2,
			maxConcurrentSpawns: 3,
		};
		const deps = makeDeps(tracker);
		const monitor = new IssueMonitor(deps, config);
		await monitor.init();

		// Fire two polls concurrently — second should be skipped
		const [r1, r2] = await Promise.all([monitor.poll(), monitor.poll()]);

		// Only one poll should have listed issues
		expect(tracker.listIssues).toHaveBeenCalledTimes(1);
	});

	it("assessIssue retries from error state", async () => {
		const issues: TrackerIssue[] = [];
		const tracker = createMockTracker(issues);
		(tracker.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
			id: "99",
			title: "Broken thing",
			body: "Details here",
			state: "open",
			url: "https://github.com/test/repo/issues/99",
		});
		const config: IssueMonitorConfig = {
			enabled: true,
			pollIntervalMs: 60000,
			filter: { state: "open" },
			assessorTimeoutMs: 180000,
			maxConcurrentAssessments: 2,
			maxConcurrentSpawns: 3,
		};
		const deps = makeDeps(tracker);
		const monitor = new IssueMonitor(deps, config);
		await monitor.init();

		// Directly seed a record in "error" state via the store
		const { IssueStore } = await import("./issue-store.js");
		const store = new IssueStore(deps.paths.issuesDir());
		await store.init();
		await store.set({
			issueId: "99",
			issueUrl: "https://github.com/test/repo/issues/99",
			title: "Broken thing",
			body: "Details here",
			state: "error",
			firstSeenAt: new Date().toISOString(),
			lastCheckedAt: new Date().toISOString(),
			error: "Transient failure",
		});

		// assessIssue should reset error→seen, then advancePipeline runs.
		// The pipeline may fail (mock limitations), but the key assertion is
		// that error→seen transition works — it doesn't throw "expected seen".
		// We verify by checking the state is no longer the original "error" with
		// the original error message.
		try {
			await monitor.assessIssue("99");
		} catch {
			// Pipeline may fail after transition — that's OK for this test
		}
		const records = await monitor.getRecords();
		expect(records.length).toBe(1);
		// The original "Transient failure" error should be cleared
		expect(records[0].error).not.toBe("Transient failure");
	});
});
