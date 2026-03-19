import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Deps, Logger, Session, SessionManager } from "@ultracoder/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runRecovery } from "./recovery.js";

/** Create a minimal mock session. */
function makeSession(overrides: Partial<Session> & { id: string }): Session {
	return {
		projectId: "proj-1",
		task: "test task",
		status: "working",
		agentType: "coder",
		workspacePath: "/tmp/ws",
		branch: "main",
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		metadata: {},
		...overrides,
	};
}

/** Create a minimal mock Deps with controllable sessions list. */
function makeDeps(sessions: Session[]): Deps {
	const logFn = vi.fn();
	const logger: Logger = {
		info: logFn,
		warn: logFn,
		error: logFn,
		debug: logFn,
		child: () => logger,
	} as unknown as Logger;

	const sessionMgr: SessionManager = {
		list: vi.fn().mockResolvedValue(sessions),
		create: vi.fn(),
		get: vi.fn(),
		update: vi.fn().mockResolvedValue({}),
		archive: vi.fn().mockResolvedValue(undefined),
		delete: vi.fn(),
	};

	return {
		logger,
		sessions: sessionMgr,
		config: {} as any,
		paths: {} as any,
		plugins: {} as any,
	} as Deps;
}

describe("recovery", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("existing behavior", () => {
		it("archives orphaned sessions with no PID or runtime", async () => {
			const session = makeSession({
				id: "s-orphan",
				status: "working",
				pid: undefined,
				runtimeId: undefined,
			});
			const deps = makeDeps([session]);
			const report = await runRecovery(deps, { dryRun: true });

			expect(report.actions).toHaveLength(1);
			expect(report.actions[0].action).toBe("archive");
			expect(report.actions[0].reason).toContain("Orphaned");
		});

		it("archives stale spawning sessions", async () => {
			const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
			const session = makeSession({
				id: "s-stale",
				status: "spawning",
				createdAt: twoHoursAgo,
			});
			// Workspace exists so we fall through to the stale check
			vi.spyOn(fs.promises, "access").mockResolvedValue(undefined);
			const deps = makeDeps([session]);
			const report = await runRecovery(deps, { dryRun: true });

			expect(report.actions).toHaveLength(1);
			expect(report.actions[0].action).toBe("archive");
			expect(report.actions[0].reason).toContain("Stale spawning");
		});

		it("restarts failed sessions under retry limit", async () => {
			const session = makeSession({
				id: "s-failed",
				status: "failed",
				metadata: { retryCount: 1 },
			});
			const deps = makeDeps([session]);
			const report = await runRecovery(deps, { dryRun: true });

			expect(report.actions).toHaveLength(1);
			expect(report.actions[0].action).toBe("restart");
		});
	});

	describe("PID liveness check", () => {
		it("archives working session when PID is dead", async () => {
			const session = makeSession({
				id: "s-dead-pid",
				status: "working",
				pid: 999999999, // very unlikely to exist
			});

			// Mock process.kill to throw (process not found)
			vi.spyOn(process, "kill").mockImplementation((_pid: number, _signal?: string | number) => {
				const err = new Error("ESRCH") as NodeJS.ErrnoException;
				err.code = "ESRCH";
				throw err;
			});

			const deps = makeDeps([session]);
			const report = await runRecovery(deps, { dryRun: true });

			expect(report.actions).toHaveLength(1);
			expect(report.actions[0].action).toBe("archive");
			expect(report.actions[0].reason).toContain("PID 999999999");
			expect(report.actions[0].reason).toContain("no longer alive");
		});

		it("does not archive working session when PID is alive", async () => {
			const session = makeSession({
				id: "s-alive-pid",
				status: "working",
				pid: process.pid, // current process — definitely alive
			});

			// Mock process.kill to succeed (signal 0 returns true for existing process)
			vi.spyOn(process, "kill").mockImplementation((_pid: number, _signal?: string | number) => {
				return true;
			});

			// Also mock fs.promises.access to succeed (workspace exists)
			vi.spyOn(fs.promises, "access").mockResolvedValue(undefined);

			const deps = makeDeps([session]);
			const report = await runRecovery(deps, { dryRun: true });

			expect(report.actions).toHaveLength(0);
		});
	});

	describe("workspace liveness check", () => {
		it("archives session when workspace directory is missing", async () => {
			const session = makeSession({
				id: "s-no-ws",
				status: "working",
				pid: 12345,
				workspacePath: "/nonexistent/path/that/does/not/exist",
			});

			// PID is alive
			vi.spyOn(process, "kill").mockImplementation((_pid: number, _signal?: string | number) => {
				return true;
			});

			// Workspace is missing
			vi.spyOn(fs.promises, "access").mockRejectedValue(
				new Error("ENOENT: no such file or directory"),
			);

			const deps = makeDeps([session]);
			const report = await runRecovery(deps, { dryRun: true });

			expect(report.actions).toHaveLength(1);
			expect(report.actions[0].action).toBe("archive");
			expect(report.actions[0].reason).toContain("Workspace missing");
			expect(report.actions[0].reason).toContain("/nonexistent/path/that/does/not/exist");
		});

		it("archives spawning session when workspace is missing", async () => {
			// Recent spawning session (not stale yet) but workspace gone
			const session = makeSession({
				id: "s-spawn-no-ws",
				status: "spawning",
				workspacePath: "/gone/workspace",
				createdAt: new Date().toISOString(), // recent
			});

			vi.spyOn(fs.promises, "access").mockRejectedValue(
				new Error("ENOENT: no such file or directory"),
			);

			const deps = makeDeps([session]);
			const report = await runRecovery(deps, { dryRun: true });

			expect(report.actions).toHaveLength(1);
			expect(report.actions[0].action).toBe("archive");
			expect(report.actions[0].reason).toContain("Workspace missing");
		});

		it("does not archive when workspace exists", async () => {
			const session = makeSession({
				id: "s-ws-ok",
				status: "working",
				pid: 12345,
				workspacePath: "/tmp/valid-workspace",
			});

			// PID alive
			vi.spyOn(process, "kill").mockImplementation(() => true);

			// Workspace exists
			vi.spyOn(fs.promises, "access").mockResolvedValue(undefined);

			const deps = makeDeps([session]);
			const report = await runRecovery(deps, { dryRun: true });

			expect(report.actions).toHaveLength(0);
		});
	});

	describe("combined checks", () => {
		it("detects dead PID before checking workspace", async () => {
			const session = makeSession({
				id: "s-dead-pid-missing-ws",
				status: "working",
				pid: 99999,
				workspacePath: "/nonexistent",
			});

			// PID is dead
			vi.spyOn(process, "kill").mockImplementation(() => {
				throw new Error("ESRCH");
			});

			const deps = makeDeps([session]);
			const report = await runRecovery(deps, { dryRun: true });

			// Should catch the dead PID first
			expect(report.actions).toHaveLength(1);
			expect(report.actions[0].reason).toContain("PID");
		});

		it("executes archive action when not in dry-run", async () => {
			const session = makeSession({
				id: "s-exec",
				status: "working",
				pid: 88888,
			});

			vi.spyOn(process, "kill").mockImplementation(() => {
				throw new Error("ESRCH");
			});

			const deps = makeDeps([session]);
			const report = await runRecovery(deps, { dryRun: false });

			expect(report.actions).toHaveLength(1);
			expect(deps.sessions.archive).toHaveBeenCalledWith("s-exec");
		});
	});
});
