import type { AgentActivity, Deps, Logger, Session } from "@ultracoder/core";
import { describe, expect, it, vi } from "vitest";
import { buildResumeContext } from "./auto-resume.js";
import { classifyIntent } from "./intent-classifier.js";
import { evaluateReaction } from "./reactions.js";
import type { ReactionConfig, TriggerMeta } from "./reactions.js";
import { canTransition, validEvents } from "./state-machine.js";

// ─── Helpers ──────────────────────────────────────────────────────────

function silentLogger(): Logger {
	return {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		child: vi.fn(() => silentLogger()),
	};
}

function makeSession(overrides: Partial<Session> = {}): Session {
	return {
		id: "test-session-1",
		projectId: "test-project",
		task: "Implement feature X",
		status: "working",
		agentType: "claude-code",
		workspacePath: "/tmp/test-ws",
		branch: "feat/x",
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		metadata: {},
		...overrides,
	};
}

// ─── 1. Reaction Escalation with Meta Tracking ─────────────────────

describe("Integration: reaction escalation with meta tracking", () => {
	it("returns notify on first ci_fail, escalates after max retries", () => {
		const logger = silentLogger();
		const session = makeSession({ status: "ci_failed" });
		const config: ReactionConfig = {
			ci_fail: { maxRetries: 2, escalateAfterMs: 1800000 },
			review_requested: { maxRetries: 0, escalateAfterMs: 0 },
			conflict: { maxRetries: 1, escalateAfterMs: 900000 },
			stuck: { maxRetries: 1, escalateAfterMs: 600000 },
			completed: { maxRetries: 0, escalateAfterMs: 0 },
		};

		// First failure: should notify
		const meta1: TriggerMeta = { retryCount: 0 };
		const action1 = evaluateReaction("ci_fail", session, logger, config, meta1);
		expect(action1.type).toBe("notify");

		// Second failure: still notify (retryCount 1 < maxRetries 2)
		const meta2: TriggerMeta = { retryCount: 1 };
		const action2 = evaluateReaction("ci_fail", session, logger, config, meta2);
		expect(action2.type).toBe("notify");

		// Third failure: escalate (retryCount 2 >= maxRetries 2)
		const meta3: TriggerMeta = { retryCount: 2 };
		const action3 = evaluateReaction("ci_fail", session, logger, config, meta3);
		expect(action3.type).toBe("escalate");
		if (action3.type === "escalate") {
			expect(action3.to).toBe("human");
		}
	});

	it("escalates on time-based threshold", () => {
		const logger = silentLogger();
		const session = makeSession({ status: "ci_failed" });
		const config: ReactionConfig = {
			ci_fail: { maxRetries: 10, escalateAfterMs: 5000 },
			review_requested: { maxRetries: 0, escalateAfterMs: 0 },
			conflict: { maxRetries: 1, escalateAfterMs: 900000 },
			stuck: { maxRetries: 1, escalateAfterMs: 600000 },
			completed: { maxRetries: 0, escalateAfterMs: 0 },
		};

		// Detected long ago (10 seconds, threshold is 5 seconds)
		const longAgo = new Date(Date.now() - 10000).toISOString();
		const meta: TriggerMeta = { retryCount: 0, firstDetectedAt: longAgo };
		const action = evaluateReaction("ci_fail", session, logger, config, meta);
		expect(action.type).toBe("escalate");
	});

	it("conflict trigger returns pause when under thresholds", () => {
		const logger = silentLogger();
		const session = makeSession({ status: "merge_conflicts" });

		const action = evaluateReaction("conflict", session, logger);
		expect(action.type).toBe("pause");
	});

	it("stuck trigger returns resume when under thresholds", () => {
		const logger = silentLogger();
		const session = makeSession({ status: "working" });

		const action = evaluateReaction("stuck", session, logger);
		expect(action.type).toBe("resume");
		if (action.type === "resume") {
			expect(action.message).toContain("stuck");
		}
	});

	it("completed trigger returns notify", () => {
		const logger = silentLogger();
		const session = makeSession({ status: "merged" });

		const action = evaluateReaction("completed", session, logger);
		expect(action.type).toBe("notify");
	});
});

// ─── 2. Intent Classification with Activity Sequences ──────────────

describe("Integration: intent classification with activity sequences", () => {
	it("classifies Read/Grep majority as exploring", () => {
		const events: AgentActivity[] = [
			{ type: "tool_call", timestamp: "2025-01-01T00:00:00Z", detail: "Read: src/foo.ts" },
			{ type: "tool_call", timestamp: "2025-01-01T00:00:01Z", detail: "Grep: pattern" },
			{ type: "tool_call", timestamp: "2025-01-01T00:00:02Z", detail: "Glob: **/*.ts" },
			{ type: "tool_call", timestamp: "2025-01-01T00:00:03Z", detail: "Read: src/bar.ts" },
			{ type: "active", timestamp: "2025-01-01T00:00:04Z" },
		];

		const result = classifyIntent(events);
		expect(result.intent).toBe("exploring");
		expect(result.confidence).toBeGreaterThan(0.5);
	});

	it("classifies test commands as testing", () => {
		const events: AgentActivity[] = [
			{
				type: "tool_call",
				timestamp: "2025-01-01T00:00:00Z",
				detail: "Bash: pnpm test",
			},
			{ type: "active", timestamp: "2025-01-01T00:00:01Z" },
			{ type: "tool_call", timestamp: "2025-01-01T00:00:02Z", detail: "Read: output.log" },
		];

		const result = classifyIntent(events);
		expect(result.intent).toBe("testing");
	});

	it("classifies git commands as committing", () => {
		const events: AgentActivity[] = [
			{
				type: "tool_call",
				timestamp: "2025-01-01T00:00:00Z",
				detail: "Bash: git add src/foo.ts",
			},
			{ type: "active", timestamp: "2025-01-01T00:00:01Z" },
			{ type: "active", timestamp: "2025-01-01T00:00:02Z" },
		];

		const result = classifyIntent(events);
		expect(result.intent).toBe("committing");
	});

	it("classifies Write/Edit majority as implementing", () => {
		const events: AgentActivity[] = [
			{
				type: "tool_call",
				timestamp: "2025-01-01T00:00:00Z",
				detail: "Write: src/new.ts",
			},
			{
				type: "tool_call",
				timestamp: "2025-01-01T00:00:01Z",
				detail: "Edit: src/existing.ts",
			},
			{
				type: "tool_call",
				timestamp: "2025-01-01T00:00:02Z",
				detail: "Write: src/another.ts",
			},
		];

		const result = classifyIntent(events);
		expect(result.intent).toBe("implementing");
		expect(result.confidence).toBeGreaterThan(0.5);
	});

	it("classifies error→Read as debugging", () => {
		const events: AgentActivity[] = [
			{ type: "error", timestamp: "2025-01-01T00:00:00Z", detail: "TypeError" },
			{
				type: "tool_call",
				timestamp: "2025-01-01T00:00:01Z",
				detail: "Read: src/broken.ts",
			},
			{ type: "active", timestamp: "2025-01-01T00:00:02Z" },
		];

		const result = classifyIntent(events);
		expect(result.intent).toBe("debugging");
	});

	it("classifies empty events as idle", () => {
		const result = classifyIntent([]);
		expect(result.intent).toBe("idle");
		expect(result.confidence).toBe(1.0);
	});

	it("classifies all idle events as idle", () => {
		const events: AgentActivity[] = [
			{ type: "idle", timestamp: "2025-01-01T00:00:00Z" },
			{ type: "idle", timestamp: "2025-01-01T00:00:01Z" },
		];

		const result = classifyIntent(events);
		expect(result.intent).toBe("idle");
		expect(result.confidence).toBe(1.0);
	});

	it("falls back to planning when no dominant pattern", () => {
		const events: AgentActivity[] = [
			{ type: "active", timestamp: "2025-01-01T00:00:00Z" },
			{ type: "active", timestamp: "2025-01-01T00:00:01Z" },
			{ type: "active", timestamp: "2025-01-01T00:00:02Z" },
		];

		const result = classifyIntent(events);
		expect(result.intent).toBe("planning");
		expect(result.confidence).toBe(0.5);
	});
});

// ─── 3. Auto-resume with buildResumeContext (mocked git) ────────────

describe("Integration: auto-resume with buildResumeContext", () => {
	it("builds resume context with mocked git output", async () => {
		// Mock child_process.execFile to avoid real git calls
		const childProcess = await import("node:child_process");
		const originalExecFile = childProcess.execFile;

		// We need to mock at the module level for buildResumeContext
		// Instead, we test the output shape with a workspace that has no git
		const logger = silentLogger();
		const session = makeSession({
			workspacePath: "/tmp/nonexistent-ws-for-test",
			metadata: { retryCount: 2 },
		});

		const mockSessions = {
			get: vi.fn().mockResolvedValue(session),
			create: vi.fn(),
			update: vi.fn(),
			list: vi.fn(),
			archive: vi.fn(),
			delete: vi.fn(),
		};

		const deps: Deps = {
			config: {} as Deps["config"],
			logger,
			plugins: {} as Deps["plugins"],
			sessions: mockSessions,
			paths: {} as Deps["paths"],
		};

		// buildResumeContext gracefully handles git failures
		const ctx = await buildResumeContext(session, deps);

		expect(ctx.originalTask).toBe("Implement feature X");
		expect(ctx.retryCount).toBe(2);
		// Git commands fail gracefully, so diff and log will be empty
		expect(ctx.gitDiff).toBe("");
		expect(ctx.filesChanged).toEqual([]);
		expect(ctx.progressSummary).toBe("No commits yet beyond main.");
	});

	it("extracts retryCount from metadata correctly", async () => {
		const logger = silentLogger();

		// Session with no retryCount in metadata
		const session1 = makeSession({ metadata: {} });
		const deps: Deps = {
			config: {} as Deps["config"],
			logger,
			plugins: {} as Deps["plugins"],
			sessions: { get: vi.fn() } as unknown as Deps["sessions"],
			paths: {} as Deps["paths"],
		};

		const ctx1 = await buildResumeContext(session1, deps);
		expect(ctx1.retryCount).toBe(0);

		// Session with retryCount
		const session2 = makeSession({ metadata: { retryCount: 5 } });
		const ctx2 = await buildResumeContext(session2, deps);
		expect(ctx2.retryCount).toBe(5);

		// Session with non-finite retryCount
		const session3 = makeSession({ metadata: { retryCount: Number.POSITIVE_INFINITY } });
		const ctx3 = await buildResumeContext(session3, deps);
		expect(ctx3.retryCount).toBe(0);
	});
});

// ─── 4. State Machine Transitions End-to-End ────────────────────────

describe("Integration: state machine transition chains", () => {
	it("validates happy path chain via canTransition", () => {
		const chain: Array<{ from: string; event: string; expected: string }> = [
			{ from: "spawning", event: "start", expected: "working" },
			{ from: "working", event: "open_pr", expected: "pr_open" },
			{ from: "pr_open", event: "request_review", expected: "review_pending" },
			{ from: "review_pending", event: "approve", expected: "approved" },
			{ from: "approved", event: "ci_pass", expected: "mergeable" },
			{ from: "mergeable", event: "merge", expected: "merged" },
			{ from: "merged", event: "archive", expected: "archived" },
		];

		for (const { from, event, expected } of chain) {
			const result = canTransition(from as any, event as any);
			expect(result.valid).toBe(true);
			expect(result.to).toBe(expected);
		}
	});

	it("rejects invalid transitions", () => {
		// Cannot merge from spawning
		const r1 = canTransition("spawning", "merge");
		expect(r1.valid).toBe(false);

		// Cannot open_pr from archived
		const r2 = canTransition("archived", "open_pr");
		expect(r2.valid).toBe(false);

		// Cannot approve from working
		const r3 = canTransition("working", "approve");
		expect(r3.valid).toBe(false);
	});

	it("lists valid events for each state", () => {
		const spawningEvents = validEvents("spawning");
		expect(spawningEvents).toContain("start");
		expect(spawningEvents).toContain("kill");
		expect(spawningEvents).not.toContain("merge");

		const archivedEvents = validEvents("archived");
		expect(archivedEvents).toHaveLength(0);

		const prOpenEvents = validEvents("pr_open");
		expect(prOpenEvents).toContain("request_review");
		expect(prOpenEvents).toContain("ci_fail");
	});

	it("validates CI failure → retry → success chain", () => {
		const chain: Array<{ from: string; event: string; expected: string }> = [
			{ from: "spawning", event: "start", expected: "working" },
			{ from: "working", event: "open_pr", expected: "pr_open" },
			{ from: "pr_open", event: "ci_fail", expected: "ci_failed" },
			{ from: "ci_failed", event: "resolve", expected: "working" },
			{ from: "working", event: "open_pr", expected: "pr_open" },
			{ from: "pr_open", event: "request_review", expected: "review_pending" },
			{ from: "review_pending", event: "approve", expected: "approved" },
			{ from: "approved", event: "ci_pass", expected: "mergeable" },
			{ from: "mergeable", event: "merge", expected: "merged" },
		];

		for (const { from, event, expected } of chain) {
			const result = canTransition(from as any, event as any);
			expect(result.valid).toBe(true);
			expect(result.to).toBe(expected);
		}
	});

	it("validates changes_requested → rework chain", () => {
		const chain: Array<{ from: string; event: string; expected: string }> = [
			{ from: "spawning", event: "start", expected: "working" },
			{ from: "working", event: "open_pr", expected: "pr_open" },
			{ from: "pr_open", event: "request_review", expected: "review_pending" },
			{ from: "review_pending", event: "request_changes", expected: "changes_requested" },
			{ from: "changes_requested", event: "resolve", expected: "working" },
			{ from: "working", event: "open_pr", expected: "pr_open" },
		];

		for (const { from, event, expected } of chain) {
			const result = canTransition(from as any, event as any);
			expect(result.valid).toBe(true);
			expect(result.to).toBe(expected);
		}
	});
});

// ─── 5. Combined: Reaction + State Machine ─────────────────────────

describe("Integration: reaction + state machine combined flow", () => {
	it("state machine drives reactions through the full error recovery flow", () => {
		const logger = silentLogger();
		const config: ReactionConfig = {
			ci_fail: { maxRetries: 2, escalateAfterMs: 1800000 },
			review_requested: { maxRetries: 0, escalateAfterMs: 0 },
			conflict: { maxRetries: 1, escalateAfterMs: 900000 },
			stuck: { maxRetries: 1, escalateAfterMs: 600000 },
			completed: { maxRetries: 0, escalateAfterMs: 0 },
		};

		// Session enters ci_failed state
		let session = makeSession({ status: "ci_failed" });

		// First CI failure: react with notify
		let meta: TriggerMeta = { retryCount: 0 };
		let action = evaluateReaction("ci_fail", session, logger, config, meta);
		expect(action.type).toBe("notify");

		// Verify we can transition back to working
		const resolveResult = canTransition("ci_failed", "resolve");
		expect(resolveResult.valid).toBe(true);
		expect(resolveResult.to).toBe("working");

		// Session fixed and PR reopened, but CI fails again
		session = makeSession({ status: "ci_failed" });
		meta = { retryCount: 1 };
		action = evaluateReaction("ci_fail", session, logger, config, meta);
		expect(action.type).toBe("notify");

		// Third failure: escalate
		meta = { retryCount: 2 };
		action = evaluateReaction("ci_fail", session, logger, config, meta);
		expect(action.type).toBe("escalate");

		// Can still archive from ci_failed
		const archiveResult = canTransition("ci_failed", "archive");
		expect(archiveResult.valid).toBe(true);
		expect(archiveResult.to).toBe("archived");
	});
});
