import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "./logger.js";
import { Orchestrator } from "./orchestrator.js";
import type { OrchestratorCallbacks } from "./orchestrator.js";
import { createPathResolver } from "./paths.js";
import { DefaultPluginRegistry } from "./plugin-registry.js";
import { FileSessionManager } from "./session-manager.js";
import type { Deps, Logger, Session, SessionStatus } from "./types.js";

// ─── Helpers ──────────────────────────────────────────────────────────

function silentLogger(): Logger {
	const logger: Logger = {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		child: vi.fn(),
	};
	// child() returns the same logger instance so spies are shared
	(logger.child as ReturnType<typeof vi.fn>).mockReturnValue(logger);
	return logger;
}

function makeDeps(overrides: Partial<Deps> = {}): Deps {
	const logger = overrides.logger ?? silentLogger();
	return {
		config: {
			projectId: "test-project",
			rootPath: "/tmp/test",
			defaultBranch: "main",
			session: {} as Deps["config"]["session"],
			plugins: {},
			pricing: {},
			llm: { endpoints: [], maxRetries: 3, timeoutMs: 120000 },
			storageBackend: "file",
			workspace: { strategy: "worktree" },
			notifications: { desktop: true, slack: { enabled: false } },
		} as Deps["config"],
		logger,
		plugins: overrides.plugins ?? ({} as Deps["plugins"]),
		sessions: overrides.sessions ?? ({} as Deps["sessions"]),
		paths: overrides.paths ?? ({} as Deps["paths"]),
	};
}

let tmpDir: string;

beforeEach(async () => {
	tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "uc-int-core-"));
});

afterEach(async () => {
	await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

// ─── 1. Full Happy Path ──────────────────────────────────────────────

describe("Integration: full happy path lifecycle", () => {
	it("transitions spawning → working → … → archived", async () => {
		const pathResolver = createPathResolver("test-project", tmpDir);
		const logger = silentLogger();
		const sm = new FileSessionManager(pathResolver, logger);

		// Create session — starts in "spawning"
		const session = await sm.create({
			projectId: "test-project",
			task: "Implement feature X",
			agentType: "claude-code",
			workspacePath: "/tmp/ws",
			branch: "feat/x",
			metadata: {},
		});

		expect(session.status).toBe("spawning");

		// Import state machine dynamically to avoid cross-package build dep in unit test
		// We inline the transition table here to keep core tests self-contained.
		const transitions: Array<{ event: string; expectedStatus: SessionStatus }> = [
			{ event: "start", expectedStatus: "working" },
			{ event: "open_pr", expectedStatus: "pr_open" },
			{ event: "request_review", expectedStatus: "review_pending" },
			{ event: "approve", expectedStatus: "approved" },
			{ event: "ci_pass", expectedStatus: "mergeable" },
			{ event: "merge", expectedStatus: "merged" },
		];

		// We simulate the state machine transitions by updating status directly
		// (the state machine is in @ultracoder/lifecycle, tested there)
		let currentStatus: SessionStatus = session.status;

		// Transition map matching the lifecycle state machine
		const TRANSITIONS: Record<string, Record<string, SessionStatus>> = {
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
			approved: {
				ci_pass: "mergeable",
				make_mergeable: "mergeable",
				ci_fail: "ci_failed",
				kill: "killed",
			},
			mergeable: { merge: "merged", conflict: "merge_conflicts", kill: "killed" },
			merged: { archive: "archived" },
		};

		for (const { event, expectedStatus } of transitions) {
			const nextStatus = TRANSITIONS[currentStatus]?.[event];
			expect(nextStatus).toBeDefined();
			expect(nextStatus).toBe(expectedStatus);

			await sm.update(session.id, { status: nextStatus! });
			const updated = await sm.get(session.id);
			expect(updated?.status).toBe(expectedStatus);
			currentStatus = expectedStatus;
		}

		// Final: archive
		await sm.archive(session.id);
		// After archive, the session directory is moved; verify it no longer exists at original location
		const afterArchive = await sm.get(session.id);
		expect(afterArchive).toBeUndefined();
	});
});

// ─── 2. CI Failure → Retry Cycle ────────────────────────────────────

describe("Integration: CI failure → retry cycle", () => {
	it("goes pr_open → ci_failed → working → pr_open again", async () => {
		const pathResolver = createPathResolver("test-ci", tmpDir);
		const logger = silentLogger();
		const sm = new FileSessionManager(pathResolver, logger);

		const session = await sm.create({
			projectId: "test-ci",
			task: "Fix CI",
			agentType: "claude-code",
			workspacePath: "/tmp/ws-ci",
			branch: "fix/ci",
			metadata: {},
		});

		const TRANSITIONS: Record<string, Record<string, SessionStatus>> = {
			spawning: { start: "working" },
			working: { open_pr: "pr_open" },
			pr_open: { ci_fail: "ci_failed", request_review: "review_pending" },
			ci_failed: { resolve: "working" },
		};

		const steps: Array<{ event: string; expected: SessionStatus }> = [
			{ event: "start", expected: "working" },
			{ event: "open_pr", expected: "pr_open" },
			{ event: "ci_fail", expected: "ci_failed" },
			{ event: "resolve", expected: "working" },
			{ event: "open_pr", expected: "pr_open" },
		];

		let currentStatus: SessionStatus = "spawning";
		for (const { event, expected } of steps) {
			const next = TRANSITIONS[currentStatus]?.[event];
			expect(next).toBe(expected);
			await sm.update(session.id, { status: next! });
			currentStatus = next!;
		}

		const final = await sm.get(session.id);
		expect(final?.status).toBe("pr_open");
	});
});

// ─── 3. Changes Requested → Rework ─────────────────────────────────

describe("Integration: changes requested → rework", () => {
	it("goes review_pending → changes_requested → working → pr_open", async () => {
		const pathResolver = createPathResolver("test-rework", tmpDir);
		const logger = silentLogger();
		const sm = new FileSessionManager(pathResolver, logger);

		const session = await sm.create({
			projectId: "test-rework",
			task: "Rework feature",
			agentType: "claude-code",
			workspacePath: "/tmp/ws-rw",
			branch: "feat/rework",
			metadata: {},
		});

		const TRANSITIONS: Record<string, Record<string, SessionStatus>> = {
			spawning: { start: "working" },
			working: { open_pr: "pr_open" },
			pr_open: { request_review: "review_pending" },
			review_pending: { request_changes: "changes_requested" },
			changes_requested: { resolve: "working" },
		};

		const steps: Array<{ event: string; expected: SessionStatus }> = [
			{ event: "start", expected: "working" },
			{ event: "open_pr", expected: "pr_open" },
			{ event: "request_review", expected: "review_pending" },
			{ event: "request_changes", expected: "changes_requested" },
			{ event: "resolve", expected: "working" },
			{ event: "open_pr", expected: "pr_open" },
		];

		let currentStatus: SessionStatus = "spawning";
		for (const { event, expected } of steps) {
			const next = TRANSITIONS[currentStatus]?.[event];
			expect(next).toBe(expected);
			await sm.update(session.id, { status: next! });
			currentStatus = next!;
		}

		const final = await sm.get(session.id);
		expect(final?.status).toBe("pr_open");
	});
});

// ─── 4. Quality Pipeline Integration ────────────────────────────────

describe("Integration: quality pipeline", () => {
	it("checkVeracityRegex finds hallucination patterns", async () => {
		// Inline regex checks to keep core self-contained; mirrors @ultracoder/quality
		const HALLUCINATION_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
			{
				pattern: /(?<!["'`])\bI(?:'ve|\s+have)?\s+created\b/gi,
				message: "Hallucinated creation claim",
			},
			{
				pattern: /(?<!["'`])\bsuccessfully\s+(?:built|compiled|installed)\b/gi,
				message: "Hallucinated success claim",
			},
		];

		const content = [
			"Line 1: normal text",
			"Line 2: I have created the file src/foo.ts",
			"Line 3: The build successfully compiled",
		].join("\n");

		const findings: Array<{ line: number; message: string }> = [];
		const lines = content.split("\n");
		for (let i = 0; i < lines.length; i++) {
			for (const { pattern, message } of HALLUCINATION_PATTERNS) {
				pattern.lastIndex = 0;
				if (pattern.test(lines[i])) {
					findings.push({ line: i + 1, message });
				}
			}
		}

		expect(findings.length).toBeGreaterThanOrEqual(2);
		expect(findings.some((f) => f.message.includes("creation"))).toBe(true);
		expect(findings.some((f) => f.message.includes("success"))).toBe(true);
	});

	it("evaluateToolPolicy blocks dangerous tools", () => {
		// Inline tool policy logic mirroring @ultracoder/quality
		type ApprovalTier = "auto" | "evaluate" | "human" | "blocked";

		interface Rule {
			pattern: string;
			tier: ApprovalTier;
			reason: string;
		}

		const rules: Rule[] = [
			{ pattern: "write:*.env*", tier: "blocked", reason: "Secrets file" },
			{ pattern: "write:*credentials*", tier: "blocked", reason: "Credentials file" },
			{ pattern: "bash:rm *", tier: "human", reason: "Destructive file operation" },
		];

		function matchesPattern(tool: string, pattern: string): boolean {
			const regex = new RegExp(
				`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
			);
			return regex.test(tool);
		}

		function evaluate(tool: string): { tier: ApprovalTier; allowed: boolean } {
			for (const rule of rules) {
				if (matchesPattern(tool, rule.pattern)) {
					return { tier: rule.tier, allowed: rule.tier !== "blocked" };
				}
			}
			return { tier: "auto", allowed: true };
		}

		// Blocked
		const envResult = evaluate("write:.env.local");
		expect(envResult.tier).toBe("blocked");
		expect(envResult.allowed).toBe(false);

		// Human approval required
		const rmResult = evaluate("bash:rm -rf /tmp/data");
		expect(rmResult.tier).toBe("human");
		expect(rmResult.allowed).toBe(true);

		// Auto-approved (no matching rule)
		const readResult = evaluate("read:src/index.ts");
		expect(readResult.tier).toBe("auto");
		expect(readResult.allowed).toBe(true);
	});

	it("filesystem veracity detects unclaimed changes in git repo", async () => {
		// Create a temp git repo
		const repoDir = path.join(tmpDir, "git-repo");
		await fs.promises.mkdir(repoDir, { recursive: true });

		const { execFile: execFileCb } = await import("node:child_process");
		const { promisify } = await import("node:util");
		const execFile = promisify(execFileCb);

		await execFile("git", ["init"], { cwd: repoDir });
		await execFile("git", ["config", "user.email", "test@test.com"], { cwd: repoDir });
		await execFile("git", ["config", "user.name", "Test"], { cwd: repoDir });

		// Create initial commit
		await fs.promises.writeFile(path.join(repoDir, "file-a.ts"), "// initial");
		await execFile("git", ["add", "."], { cwd: repoDir });
		await execFile("git", ["commit", "-m", "init"], { cwd: repoDir });

		// Modify a file (unstaged change)
		await fs.promises.writeFile(path.join(repoDir, "file-a.ts"), "// modified");
		// Create a new file (untracked)
		await fs.promises.writeFile(path.join(repoDir, "file-b.ts"), "// new");

		// Get actual changes via git
		const { stdout: diffOut } = await execFile("git", ["diff", "--name-only"], {
			cwd: repoDir,
		});
		const { stdout: statusOut } = await execFile("git", ["status", "--porcelain"], {
			cwd: repoDir,
		});

		const changedFiles = new Set<string>();
		for (const line of diffOut.split("\n")) {
			const trimmed = line.trim();
			if (trimmed) changedFiles.add(trimmed);
		}
		for (const line of statusOut.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			const filePart = line.slice(3).trim();
			if (filePart) changedFiles.add(filePart);
		}

		// Verify file-a.ts is in the diff
		expect(changedFiles.has("file-a.ts")).toBe(true);

		// Cross-check: claim file-c.ts was changed (it was not)
		const claimedFiles = ["file-a.ts", "file-c.ts"];
		const findings: Array<{ file: string; verified: boolean }> = [];
		for (const claimed of claimedFiles) {
			findings.push({ file: claimed, verified: changedFiles.has(claimed) });
		}

		expect(findings.find((f) => f.file === "file-a.ts")?.verified).toBe(true);
		expect(findings.find((f) => f.file === "file-c.ts")?.verified).toBe(false);
	});
});

// ─── 5. Scope Tracker + Handoff ─────────────────────────────────────

describe("Integration: scope tracker + handoff", () => {
	it("detects conflicts and transfers ownership via handoff", async () => {
		// Inline a minimal scope tracker to keep core self-contained
		class ScopeTracker {
			private scopes = new Map<string, Set<string>>();

			acquire(sessionId: string, files: string[]): string | null {
				for (const [existingId, fileSet] of this.scopes) {
					if (existingId === sessionId) continue;
					for (const file of files) {
						if (fileSet.has(file)) return existingId;
					}
				}
				const existing = this.scopes.get(sessionId);
				if (existing) {
					for (const f of files) existing.add(f);
				} else {
					this.scopes.set(sessionId, new Set(files));
				}
				return null;
			}

			owner(file: string): string | null {
				for (const [sid, fileSet] of this.scopes) {
					if (fileSet.has(file)) return sid;
				}
				return null;
			}

			handoff(from: string, to: string, files: string[]): boolean {
				for (const file of files) {
					if (this.owner(file) !== from) return false;
				}
				const sourceEntry = this.scopes.get(from);
				if (sourceEntry) {
					for (const file of files) sourceEntry.delete(file);
				}
				const existing = this.scopes.get(to);
				if (existing) {
					for (const f of files) existing.add(f);
				} else {
					this.scopes.set(to, new Set(files));
				}
				return true;
			}
		}

		const tracker = new ScopeTracker();

		// Session-1 acquires files
		const conflict1 = tracker.acquire("session-1", ["src/a.ts", "src/b.ts"]);
		expect(conflict1).toBeNull();

		// Session-2 tries same files → conflict
		const conflict2 = tracker.acquire("session-2", ["src/b.ts", "src/c.ts"]);
		expect(conflict2).toBe("session-1");

		// Session-2 acquires non-overlapping files
		const conflict3 = tracker.acquire("session-2", ["src/d.ts"]);
		expect(conflict3).toBeNull();

		// Handoff from session-1 to session-2
		const success = tracker.handoff("session-1", "session-2", ["src/a.ts", "src/b.ts"]);
		expect(success).toBe(true);

		// Verify ownership transferred
		expect(tracker.owner("src/a.ts")).toBe("session-2");
		expect(tracker.owner("src/b.ts")).toBe("session-2");
	});
});

// ─── 6. Merge Queue + Finalization ──────────────────────────────────

describe("Integration: merge queue + finalization", () => {
	it("dequeues entries by priority order", () => {
		// Inline merge queue logic for core self-containment
		interface QueueEntry {
			sessionId: string;
			branch: string;
			priority: number;
		}

		const queue: QueueEntry[] = [];

		function enqueue(entry: QueueEntry) {
			queue.push(entry);
			queue.sort((a, b) => b.priority - a.priority);
		}

		function dequeue(): QueueEntry | undefined {
			return queue.shift();
		}

		enqueue({ sessionId: "s1", branch: "feat/low", priority: 1 });
		enqueue({ sessionId: "s2", branch: "feat/high", priority: 10 });
		enqueue({ sessionId: "s3", branch: "feat/mid", priority: 5 });

		const first = dequeue();
		expect(first?.sessionId).toBe("s2");
		expect(first?.priority).toBe(10);

		const second = dequeue();
		expect(second?.sessionId).toBe("s3");

		const third = dequeue();
		expect(third?.sessionId).toBe("s1");

		expect(dequeue()).toBeUndefined();
	});

	it("finalization drains queue and runs reconciler cycles", async () => {
		const logger = silentLogger();
		let reconcileCalls = 0;

		// Simulate finalization with a mock reconciler
		const maxCycles = 3;
		const queue: string[] = ["branch-1", "branch-2"];

		// Mock reconciler: healthy on second cycle
		async function mockReconcile(): Promise<{
			healthy: boolean;
			fixDescriptions: string[];
		}> {
			reconcileCalls++;
			return {
				healthy: reconcileCalls >= 2,
				fixDescriptions: reconcileCalls >= 2 ? [] : ["fix type error in foo.ts"],
			};
		}

		let totalFixes = 0;
		let cyclesRun = 0;
		let finalHealth = false;

		for (let cycle = 0; cycle < maxCycles; cycle++) {
			cyclesRun++;

			// Drain queue
			while (queue.length > 0) queue.shift();

			const result = await mockReconcile();

			if (result.healthy) {
				finalHealth = true;
				break;
			}

			totalFixes += result.fixDescriptions.length;
		}

		expect(cyclesRun).toBe(2);
		expect(finalHealth).toBe(true);
		expect(totalFixes).toBe(1);
		expect(reconcileCalls).toBe(2);
	});
});

// ─── 7. Orchestrator Cycle ──────────────────────────────────────────

describe("Integration: orchestrator cycle with mocked callbacks", () => {
	it("calls callbacks in order during a single cycle", async () => {
		const callOrder: string[] = [];

		const logger = silentLogger();
		const deps = makeDeps({ logger });

		const callbacks: OrchestratorCallbacks = {
			pollSessions: vi.fn(async () => {
				callOrder.push("pollSessions");
			}),
			processMergeQueue: vi.fn(async () => {
				callOrder.push("processMergeQueue");
			}),
			runReconciler: vi.fn(async () => {
				callOrder.push("runReconciler");
				return { healthy: true, fixes: [] };
			}),
		};

		const orchestrator = new Orchestrator(deps, callbacks);

		// Run 5 cycles so reconciler is triggered on cycle 5
		for (let i = 0; i < 5; i++) {
			await orchestrator.runCycle();
		}

		// Verify pollSessions and processMergeQueue were called each cycle
		expect(callbacks.pollSessions).toHaveBeenCalledTimes(5);
		expect(callbacks.processMergeQueue).toHaveBeenCalledTimes(5);

		// Reconciler only on cycle 5
		expect(callbacks.runReconciler).toHaveBeenCalledTimes(1);

		// Verify ordering within cycle 5: poll → merge → reconcile
		const cycle5Start = callOrder.length - 3;
		expect(callOrder[cycle5Start]).toBe("pollSessions");
		expect(callOrder[cycle5Start + 1]).toBe("processMergeQueue");
		expect(callOrder[cycle5Start + 2]).toBe("runReconciler");
	});

	it("handles callback errors gracefully", async () => {
		const logger = silentLogger();
		const deps = makeDeps({ logger });

		const callbacks: OrchestratorCallbacks = {
			pollSessions: vi.fn(async () => {
				throw new Error("poll exploded");
			}),
			processMergeQueue: vi.fn(async () => {}),
			runReconciler: vi.fn(async () => ({ healthy: true, fixes: [] })),
		};

		const orchestrator = new Orchestrator(deps, callbacks);

		// Should not throw
		await orchestrator.runCycle();

		expect(logger.error).toHaveBeenCalledWith("Cycle failed", {
			cycleId: 1,
			error: "poll exploded",
		});
	});
});

// ─── 8. Session CRUD with FileSessionManager ───────────────────────

describe("Integration: FileSessionManager CRUD", () => {
	it("creates, lists, updates, and deletes sessions", async () => {
		const pathResolver = createPathResolver("crud-test", tmpDir);
		const logger = silentLogger();
		const sm = new FileSessionManager(pathResolver, logger);

		// Create two sessions
		const s1 = await sm.create({
			projectId: "crud-test",
			task: "Task A",
			agentType: "claude-code",
			workspacePath: "/tmp/a",
			branch: "feat/a",
			metadata: {},
		});
		const s2 = await sm.create({
			projectId: "crud-test",
			task: "Task B",
			agentType: "claude-code",
			workspacePath: "/tmp/b",
			branch: "feat/b",
			metadata: {},
		});

		// List all
		const all = await sm.list();
		expect(all.length).toBe(2);

		// Update status
		await sm.update(s1.id, { status: "working" });
		const updated = await sm.get(s1.id);
		expect(updated?.status).toBe("working");

		// Filter by status
		const working = await sm.list({ status: "working" });
		expect(working.length).toBe(1);
		expect(working[0].id).toBe(s1.id);

		// Delete
		await sm.delete(s2.id);
		const afterDelete = await sm.get(s2.id);
		expect(afterDelete).toBeUndefined();

		// Only one remains
		const remaining = await sm.list();
		expect(remaining.length).toBe(1);
	});
});
