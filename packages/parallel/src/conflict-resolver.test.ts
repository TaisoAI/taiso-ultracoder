import type { Logger } from "@ultracoder/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock child_process following the same pattern as decomposer.test.ts
const { mockExecFile } = vi.hoisted(() => {
	const fn = vi.fn();
	return { mockExecFile: fn };
});

vi.mock("node:child_process", async (importOriginal) => {
	const { promisify } = await import("node:util");
	const original = await importOriginal<typeof import("node:child_process")>();

	(mockExecFile as any)[promisify.custom] = (...args: any[]) => {
		return new Promise((resolve, reject) => {
			mockExecFile(...args, (err: any, stdout: any, stderr: any) => {
				if (err) {
					reject(err);
				} else {
					resolve({ stdout, stderr });
				}
			});
		});
	};

	return {
		...original,
		execFile: mockExecFile,
	};
});

import { identifyConflictFiles, generateConflictTask } from "./conflict-resolver.js";

const mockLogger: Logger = {
	debug: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	child: vi.fn(() => mockLogger),
};

describe("identifyConflictFiles", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("returns file list from git merge-tree output with conflict markers", async () => {
		let callCount = 0;
		mockExecFile.mockImplementation((_cmd: any, args: any, _opts: any, cb?: any) => {
			callCount++;
			const callback = typeof _opts === "function" ? _opts : cb;
			if (callCount === 1) {
				// git merge-base
				if (callback) callback(null, "abc123\n", "");
			} else {
				// git merge-tree — output with conflict markers and diff headers
				const output = [
					"changed in both",
					"--- a/src/utils.ts",
					"+++ b/src/utils.ts",
					"+<<<<<<< ",
					"+  our version",
					"+=======",
					"+  their version",
					"+>>>>>>>",
					"changed in both",
					"--- a/src/index.ts",
					"+++ b/src/index.ts",
					"+<<<<<<< ",
					"+  conflict here",
					"+=======",
					"+>>>>>>>",
				].join("\n");
				if (callback) callback(null, output, "");
			}
			return {} as any;
		});

		const files = await identifyConflictFiles("feature-a", "main", "/repo");
		expect(files).toEqual(["src/utils.ts", "src/index.ts"]);
	});

	it("returns empty array on git failure (graceful degradation)", async () => {
		mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, cb?: any) => {
			const callback = typeof _opts === "function" ? _opts : cb;
			if (callback) callback(new Error("git not found"), "", "");
			return {} as any;
		});

		const files = await identifyConflictFiles("feature-a", "main", "/repo");
		expect(files).toEqual([]);
	});

	it("falls back to merge approach when merge-tree fails", async () => {
		let callCount = 0;
		mockExecFile.mockImplementation((_cmd: any, args: any, _opts: any, cb?: any) => {
			callCount++;
			const callback = typeof _opts === "function" ? _opts : cb;

			const argList = Array.isArray(args) ? args : [];

			if (callCount <= 2) {
				// merge-base or merge-tree fails
				if (callback) callback(new Error("merge-tree failed"), "", "");
			} else if (argList.includes("merge") && argList.includes("--no-commit")) {
				// fallback merge fails (conflicts)
				if (callback) callback(new Error("merge conflict"), "", "");
			} else if (argList.includes("diff")) {
				// git diff --name-only --diff-filter=U
				if (callback) callback(null, "src/conflicted.ts\nsrc/other.ts\n", "");
			} else if (argList.includes("--abort")) {
				// git merge --abort
				if (callback) callback(null, "", "");
			} else {
				if (callback) callback(null, "", "");
			}
			return {} as any;
		});

		const files = await identifyConflictFiles("feature-a", "main", "/repo");
		expect(files).toEqual(["src/conflicted.ts", "src/other.ts"]);
	});
});

describe("generateConflictTask", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("produces task string containing conflict file names", async () => {
		// Mock identifyConflictFiles to return known files via merge-tree
		let callCount = 0;
		mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, cb?: any) => {
			callCount++;
			const callback = typeof _opts === "function" ? _opts : cb;
			if (callCount === 1) {
				if (callback) callback(null, "abc123\n", "");
			} else {
				const output = [
					"+++ b/src/api.ts",
					"+<<<<<<<",
					"+=======",
					"+>>>>>>>",
				].join("\n");
				if (callback) callback(null, output, "");
			}
			return {} as any;
		});

		const result = await generateConflictTask({
			branch: "feature-x",
			targetBranch: "main",
			sessionId: "sess-001",
			originalTask: "Implement the API layer",
			cwd: "/repo",
			logger: mockLogger,
		});

		expect(result.task).toContain("src/api.ts");
		expect(result.task).toContain("feature-x");
		expect(result.task).toContain("main");
		expect(result.conflictFiles).toEqual(["src/api.ts"]);
	});

	it("includes original task context in the generated task", async () => {
		let callCount = 0;
		mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, cb?: any) => {
			callCount++;
			const callback = typeof _opts === "function" ? _opts : cb;
			if (callCount === 1) {
				if (callback) callback(null, "abc123\n", "");
			} else {
				const output = "+++ b/file.ts\n+<<<<<<<\n+=======\n+>>>>>>>";
				if (callback) callback(null, output, "");
			}
			return {} as any;
		});

		const result = await generateConflictTask({
			branch: "feature-y",
			targetBranch: "main",
			sessionId: "sess-002",
			originalTask: "Build the authentication module",
			cwd: "/repo",
			logger: mockLogger,
		});

		expect(result.task).toContain("Build the authentication module");
		expect(result.task).toContain("Original task context:");
	});

	it("handles empty conflict files list gracefully", async () => {
		// All git commands fail → empty conflict files
		mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, cb?: any) => {
			const callback = typeof _opts === "function" ? _opts : cb;
			if (callback) callback(new Error("git error"), "", "");
			return {} as any;
		});

		const result = await generateConflictTask({
			branch: "feature-z",
			targetBranch: "main",
			sessionId: "sess-003",
			originalTask: "Add logging",
			cwd: "/repo",
			logger: mockLogger,
		});

		expect(result.task).toContain("(unable to determine — check manually)");
		expect(result.conflictFiles).toEqual([]);
	});

	it("sets metadata with source and originalSessionId", async () => {
		mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, cb?: any) => {
			const callback = typeof _opts === "function" ? _opts : cb;
			if (callback) callback(new Error("git error"), "", "");
			return {} as any;
		});

		const result = await generateConflictTask({
			branch: "feature-w",
			targetBranch: "develop",
			sessionId: "sess-042",
			originalTask: "Refactor models",
			cwd: "/repo",
			logger: mockLogger,
		});

		expect(result.metadata).toEqual({
			source: "conflict-resolver",
			originalSessionId: "sess-042",
		});
		expect(result.branch).toBe("feature-w");
		expect(result.targetBranch).toBe("develop");
	});
});
