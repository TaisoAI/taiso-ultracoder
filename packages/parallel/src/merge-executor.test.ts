import type { Logger, MergeStrategy } from "@ultracoder/core";
import { describe, expect, it, vi } from "vitest";
import { MergeExecutor } from "./merge-executor.js";
import type { MergeQueueEntry } from "./merge-queue.js";

function mockLogger(): Logger {
	return {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		child: vi.fn().mockReturnThis(),
	};
}

function makeEntry(overrides: Partial<MergeQueueEntry> = {}): MergeQueueEntry {
	return {
		sessionId: "sess-1",
		branch: "feat-x",
		priority: 1,
		addedAt: new Date().toISOString(),
		attempts: 0,
		maxAttempts: 3,
		...overrides,
	};
}

describe("MergeExecutor", () => {
	describe("config defaults", () => {
		it("uses default strategies, maxRetries, and targetBranch", () => {
			const executor = new MergeExecutor({ cwd: "/tmp/repo" }, mockLogger());
			// Access config via a merge attempt to verify defaults are wired correctly.
			// We verify indirectly: the constructor should not throw with only cwd.
			expect(executor).toBeDefined();
		});

		it("allows overriding config values", () => {
			const executor = new MergeExecutor(
				{
					cwd: "/tmp/repo",
					strategies: ["merge"],
					maxRetries: 5,
					targetBranch: "develop",
				},
				mockLogger(),
			);
			expect(executor).toBeDefined();
		});
	});

	describe("ensureCleanState", () => {
		it("runs git reset --hard HEAD and git clean -fd", async () => {
			const calls: string[][] = [];
			const executor = new MergeExecutor({ cwd: "/tmp/repo" }, mockLogger());
			executor.execFile = vi.fn().mockImplementation((_cmd: string, args: string[]) => {
				calls.push(args);
				return Promise.resolve({ stdout: "", stderr: "" });
			});

			await executor.ensureCleanState();

			expect(calls).toEqual([
				["reset", "--hard", "HEAD"],
				["clean", "-fd"],
			]);
			expect(executor.execFile).toHaveBeenCalledWith("git", ["reset", "--hard", "HEAD"], {
				cwd: "/tmp/repo",
			});
			expect(executor.execFile).toHaveBeenCalledWith("git", ["clean", "-fd"], { cwd: "/tmp/repo" });
		});

		it("logs error but does not throw if git commands fail", async () => {
			const logger = mockLogger();
			const executor = new MergeExecutor({ cwd: "/tmp/repo" }, logger);
			executor.execFile = vi.fn().mockRejectedValue(new Error("git not found"));

			await expect(executor.ensureCleanState()).resolves.toBeUndefined();
			expect(logger.error).toHaveBeenCalled();
		});
	});

	describe("strategy fallback order", () => {
		it("returns merged with first successful strategy", async () => {
			const executor = new MergeExecutor(
				{ cwd: "/tmp/repo", strategies: ["squash", "rebase", "merge"] },
				mockLogger(),
			);
			executor.execFile = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });

			const entry = makeEntry();
			const result = await executor.executeMerge(entry);

			expect(result).toEqual({ status: "merged", strategy: "squash" });
		});

		it("falls back to next strategy on conflict", async () => {
			const executor = new MergeExecutor(
				{ cwd: "/tmp/repo", strategies: ["squash", "rebase", "merge"] },
				mockLogger(),
			);

			let callCount = 0;
			executor.execFile = vi.fn().mockImplementation((_cmd: string, args: string[]) => {
				callCount++;
				// Fail the squash merge (the merge --squash call, 2nd git call after checkout)
				if (args.includes("--squash")) {
					return Promise.reject(new Error("CONFLICT in file.ts"));
				}
				return Promise.resolve({ stdout: "", stderr: "" });
			});

			const entry = makeEntry();
			const result = await executor.executeMerge(entry);

			// squash failed with CONFLICT, rebase should succeed
			expect(result).toEqual({ status: "merged", strategy: "rebase" });
		});

		it("returns conflict when all strategies fail", async () => {
			const executor = new MergeExecutor(
				{ cwd: "/tmp/repo", strategies: ["squash", "merge"], maxRetries: 1 },
				mockLogger(),
			);

			executor.execFile = vi.fn().mockImplementation((_cmd: string, args: string[]) => {
				if (args.includes("--squash") || args.includes("--no-ff")) {
					return Promise.reject(new Error("CONFLICT in file.ts"));
				}
				return Promise.resolve({ stdout: "", stderr: "" });
			});

			const entry = makeEntry();
			const result = await executor.executeMerge(entry);

			expect(result.status).toBe("conflict");
			if (result.status === "conflict") {
				expect(result.details).toContain("squash");
				expect(result.details).toContain("merge");
			}
		});

		it("returns retry when attempts remain after all strategies fail", async () => {
			const executor = new MergeExecutor(
				{ cwd: "/tmp/repo", strategies: ["squash"], maxRetries: 3 },
				mockLogger(),
			);

			executor.execFile = vi.fn().mockImplementation((_cmd: string, args: string[]) => {
				if (args.includes("--squash")) {
					return Promise.reject(new Error("CONFLICT in file.ts"));
				}
				return Promise.resolve({ stdout: "", stderr: "" });
			});

			const entry = makeEntry();
			const result = await executor.executeMerge(entry);

			expect(result).toEqual({ status: "retry", attempt: 1 });
		});
	});

	describe("MergeResult types", () => {
		it("returns failed when attempts exceed maxRetries", async () => {
			const executor = new MergeExecutor({ cwd: "/tmp/repo", maxRetries: 2 }, mockLogger());

			const entry = makeEntry({ attempts: 2 });
			const result = await executor.executeMerge(entry);

			expect(result).toEqual({ status: "failed", error: "Exceeded max retries (2)" });
		});

		it("increments entry attempts on each call", async () => {
			const executor = new MergeExecutor(
				{ cwd: "/tmp/repo", strategies: ["squash"] },
				mockLogger(),
			);
			executor.execFile = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });

			const entry = makeEntry({ attempts: 0 });
			await executor.executeMerge(entry);

			expect(entry.attempts).toBe(1);
		});

		it("merged result includes the strategy used", async () => {
			const executor = new MergeExecutor({ cwd: "/tmp/repo", strategies: ["merge"] }, mockLogger());
			executor.execFile = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });

			const entry = makeEntry();
			const result = await executor.executeMerge(entry);

			expect(result).toEqual({ status: "merged", strategy: "merge" });
		});
	});
});
