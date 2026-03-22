import type { Logger } from "@ultracoder/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HandoffReport } from "./handoff.js";

// Mock child_process the same way as decomposer.test.ts
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

import { shouldReplan, replan } from "./replanner.js";

// ─── helpers ────────────────────────────────────────────────────────

function makeHandoff(overrides: Partial<HandoffReport> = {}): HandoffReport {
	return {
		sessionId: "sess-1",
		task: "Implement feature",
		status: "completed",
		summary: "Done",
		diff: "",
		metrics: { linesAdded: 10, linesRemoved: 2, filesChanged: ["a.ts"] },
		concerns: [],
		suggestions: [],
		timestamp: new Date().toISOString(),
		...overrides,
	};
}

const mockLogger: Logger = {
	debug: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	child: vi.fn(function (this: Logger) {
		return this;
	}) as any,
};

// ─── shouldReplan ───────────────────────────────────────────────────

describe("shouldReplan", () => {
	it("returns false when all handoffs completed without concerns", () => {
		const handoffs = [
			makeHandoff({ sessionId: "s1", status: "completed", concerns: [] }),
			makeHandoff({ sessionId: "s2", status: "completed", concerns: [] }),
		];

		const decision = shouldReplan(handoffs);
		expect(decision.shouldReplan).toBe(false);
		expect(decision.reason).toBe("All tasks completed successfully");
	});

	it("returns true with reason mentioning failed when a handoff failed", () => {
		const handoffs = [
			makeHandoff({ sessionId: "s1", status: "completed" }),
			makeHandoff({ sessionId: "s2", status: "failed" }),
		];

		const decision = shouldReplan(handoffs);
		expect(decision.shouldReplan).toBe(true);
		expect(decision.reason).toContain("failed");
		expect(decision.reason).toContain("s2");
	});

	it("returns true when a handoff has partial status", () => {
		const handoffs = [
			makeHandoff({ sessionId: "s1", status: "partial" }),
		];

		const decision = shouldReplan(handoffs);
		expect(decision.shouldReplan).toBe(true);
		expect(decision.reason).toContain("partially completed");
		expect(decision.reason).toContain("s1");
	});

	it("returns true when completed handoffs have concerns", () => {
		const handoffs = [
			makeHandoff({
				sessionId: "s1",
				status: "completed",
				concerns: ["Possible race condition"],
			}),
		];

		const decision = shouldReplan(handoffs);
		expect(decision.shouldReplan).toBe(true);
		expect(decision.reason).toContain("concerns");
		expect(decision.reason).toContain("s1");
	});

	it("prioritises failed over partial and concerns", () => {
		const handoffs = [
			makeHandoff({ sessionId: "s1", status: "failed" }),
			makeHandoff({ sessionId: "s2", status: "partial" }),
			makeHandoff({
				sessionId: "s3",
				status: "completed",
				concerns: ["Something"],
			}),
		];

		const decision = shouldReplan(handoffs);
		expect(decision.shouldReplan).toBe(true);
		// Failed takes precedence
		expect(decision.reason).toContain("failed");
	});
});

// ─── replan ─────────────────────────────────────────────────────────

describe("replan", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("calls decomposeTask with enriched prompt containing completed and failed summaries", async () => {
		let capturedPrompt = "";

		mockExecFile.mockImplementation((_cmd: any, args: any, _opts: any, cb?: any) => {
			// The prompt is the second element in the args array (after "-p")
			capturedPrompt = args[1];
			const callback = typeof _opts === "function" ? _opts : cb;
			const output = JSON.stringify({
				subtasks: [
					{
						id: "sub-1",
						title: "Retry failed work",
						description: "Redo the failed task",
						dependencies: [],
						scope: ["x.ts"],
						priority: 1,
					},
				],
			});
			if (callback) callback(null, output, "");
			return {} as any;
		});

		const completed = [
			makeHandoff({ task: "Add tests", summary: "Tests added for module A" }),
		];
		const failed = [
			makeHandoff({
				task: "Fix bug",
				status: "failed",
				summary: "Could not reproduce",
			}),
		];

		await replan(
			"Ship feature X",
			completed,
			failed,
			{ files: ["x.ts", "y.ts"] },
			mockLogger,
			{ agentPath: "mock-agent", timeoutMs: 5000 },
		);

		expect(capturedPrompt).toContain("Original task: Ship feature X");
		expect(capturedPrompt).toContain("Add tests: Tests added for module A");
		expect(capturedPrompt).toContain("Fix bug: FAILED - Could not reproduce");
		expect(capturedPrompt).toContain("decompose the remaining work");
	});

	it("returns context with correct completed and failed summaries", async () => {
		mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, cb?: any) => {
			const callback = typeof _opts === "function" ? _opts : cb;
			const output = JSON.stringify({
				subtasks: [
					{
						id: "sub-1",
						title: "Next step",
						description: "Continue work",
						dependencies: [],
						scope: ["a.ts"],
						priority: 1,
					},
				],
			});
			if (callback) callback(null, output, "");
			return {} as any;
		});

		const completed = [
			makeHandoff({ task: "Task A", summary: "Done A" }),
			makeHandoff({ task: "Task B", summary: "Done B" }),
		];
		const failed = [
			makeHandoff({ task: "Task C", status: "failed", summary: "Error C" }),
		];

		const result = await replan(
			"Big project",
			completed,
			failed,
			{ files: ["a.ts"] },
			mockLogger,
		);

		expect(result.context.completedSummaries).toEqual([
			"Task A: Done A",
			"Task B: Done B",
		]);
		expect(result.context.failedSummaries).toEqual([
			"Task C: FAILED - Error C",
		]);
		expect(result.context.remainingWork).toContain("Original task: Big project");
		expect(result.newTasks.subtasks).toHaveLength(1);
		expect(result.newTasks.subtasks[0].title).toBe("Next step");
	});
});
