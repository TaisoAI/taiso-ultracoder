import * as fs from "node:fs";
import type { Deps, Logger, Session } from "@ultracoder/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ResumeContext, buildResumeContext, handleAutoResume } from "./auto-resume.js";

// ─── Mock child_process ──────────────────────────────────────────────

vi.mock("node:child_process", () => {
	const execFileFn = vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
		cb(null, { stdout: "", stderr: "" });
	});
	return { execFile: execFileFn };
});

import { execFile as execFileCb } from "node:child_process";
const mockExecFile = vi.mocked(execFileCb);

// ─── Mock fs ─────────────────────────────────────────────────────────

vi.mock("node:fs", async () => {
	const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
	return {
		...actual,
		promises: {
			...actual.promises,
			mkdir: vi.fn().mockResolvedValue(undefined),
			writeFile: vi.fn().mockResolvedValue(undefined),
		},
	};
});

// ─── Helpers ─────────────────────────────────────────────────────────

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
		task: "Fix the login bug",
		status: "failed",
		agentType: "claude",
		workspacePath: "/tmp/workspace",
		branch: "fix/login",
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		metadata: {},
		...overrides,
	};
}

function makeDeps(sessionOverrides?: Partial<Session>): Deps {
	const session = makeSession(sessionOverrides);
	return {
		logger: makeLogger(),
		sessions: {
			list: vi.fn().mockResolvedValue([]),
			get: vi.fn().mockResolvedValue(session),
			update: vi.fn().mockImplementation((_id, patch) => Promise.resolve({ ...session, ...patch })),
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
		config: { defaultBranch: "main" } as Deps["config"],
	} as unknown as Deps;
}

function setupExecFile(responses: Record<string, string>) {
	mockExecFile.mockImplementation(
		(_cmd: string, args: readonly string[], _opts: unknown, cb: Function) => {
			const key = (args as string[]).join(" ");
			for (const [pattern, stdout] of Object.entries(responses)) {
				if (key.includes(pattern)) {
					cb(null, { stdout, stderr: "" });
					return undefined as any;
				}
			}
			cb(null, { stdout: "", stderr: "" });
			return undefined as any;
		},
	);
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("buildResumeContext", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns structured context with task, diff, and progress", async () => {
		const session = makeSession({ task: "Implement feature X" });
		const deps = makeDeps();

		setupExecFile({
			"diff main...HEAD --stat": " src/foo.ts | 10 ++++\n src/bar.ts | 5 ++\n 2 files changed",
			"diff main...HEAD": "+added line\n-removed line",
			"log --oneline main...HEAD": "abc1234 Add feature X\ndef5678 Fix tests",
		});

		const ctx = await buildResumeContext(session, deps);

		expect(ctx.originalTask).toBe("Implement feature X");
		expect(ctx.gitDiff).toContain("+added line");
		expect(ctx.progressSummary).toContain("abc1234");
		expect(ctx.filesChanged).toEqual(["src/foo.ts", "src/bar.ts"]);
		expect(ctx.retryCount).toBe(0);
	});

	it("uses retryCount from session metadata", async () => {
		const session = makeSession({ metadata: { retryCount: 2 } });
		const deps = makeDeps();
		setupExecFile({});

		const ctx = await buildResumeContext(session, deps);
		expect(ctx.retryCount).toBe(2);
	});

	it("returns empty strings when git commands fail", async () => {
		const session = makeSession();
		const deps = makeDeps();

		mockExecFile.mockImplementation(
			(_cmd: string, _args: readonly string[], _opts: unknown, cb: Function) => {
				cb(new Error("not a git repo"), { stdout: "", stderr: "" });
				return undefined as any;
			},
		);

		const ctx = await buildResumeContext(session, deps);

		expect(ctx.gitDiff).toBe("");
		expect(ctx.progressSummary).toBe("No commits yet beyond main.");
		expect(ctx.filesChanged).toEqual([]);
	});

	it("parses filesChanged from git diff --stat output", async () => {
		const session = makeSession();
		const deps = makeDeps();

		setupExecFile({
			"diff main...HEAD --stat":
				" packages/a/src/index.ts | 3 +++\n packages/b/test/b.test.ts | 12 ++++++------\n 2 files changed",
		});

		const ctx = await buildResumeContext(session, deps);
		expect(ctx.filesChanged).toEqual(["packages/a/src/index.ts", "packages/b/test/b.test.ts"]);
	});
});

describe("handleAutoResume with resume context", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("attaches resumeContext to session metadata on resume", async () => {
		const session = makeSession({ status: "failed", metadata: { retryCount: 0 } });
		const deps = makeDeps({ status: "failed", metadata: { retryCount: 0 } });

		setupExecFile({
			"log --oneline main...HEAD": "abc123 initial work",
		});

		const promise = handleAutoResume(session, deps, { cooldownSeconds: 0 });
		// Advance past cooldown
		await vi.advanceTimersByTimeAsync(100);
		const result = await promise;

		expect(result).toBe(true);
		expect((deps.sessions as any).update).toHaveBeenCalledWith(
			"sess-1",
			expect.objectContaining({
				status: "working",
				metadata: expect.objectContaining({
					retryCount: 1,
					resumeContext: expect.objectContaining({
						originalTask: "Fix the login bug",
					}),
				}),
			}),
		);
	});

	it("writes progress.md to workspace before transitioning", async () => {
		const session = makeSession({ status: "failed", metadata: { retryCount: 0 } });
		const deps = makeDeps({ status: "failed", metadata: { retryCount: 0 } });

		setupExecFile({});

		const promise = handleAutoResume(session, deps, { cooldownSeconds: 0 });
		await vi.advanceTimersByTimeAsync(100);
		await promise;

		expect(fs.promises.mkdir).toHaveBeenCalledWith("/tmp/workspace/.ultracoder", {
			recursive: true,
		});
		expect(fs.promises.writeFile).toHaveBeenCalledWith(
			"/tmp/workspace/.ultracoder/progress.md",
			expect.stringContaining("# Resume Context"),
			"utf-8",
		);
	});

	it("still resumes even if progress file write fails", async () => {
		const session = makeSession({ status: "failed", metadata: { retryCount: 0 } });
		const deps = makeDeps({ status: "failed", metadata: { retryCount: 0 } });

		vi.mocked(fs.promises.mkdir).mockRejectedValueOnce(new Error("permission denied"));
		setupExecFile({});

		const promise = handleAutoResume(session, deps, { cooldownSeconds: 0 });
		await vi.advanceTimersByTimeAsync(100);
		const result = await promise;

		expect(result).toBe(true);
	});

	it("returns false when disabled", async () => {
		const session = makeSession({ status: "failed" });
		const deps = makeDeps();

		const result = await handleAutoResume(session, deps, { enabled: false });
		expect(result).toBe(false);
	});

	it("returns false when max retries exceeded", async () => {
		const session = makeSession({ status: "failed", metadata: { retryCount: 3 } });
		const deps = makeDeps();

		const result = await handleAutoResume(session, deps, { maxRetries: 3 });
		expect(result).toBe(false);
	});
});
