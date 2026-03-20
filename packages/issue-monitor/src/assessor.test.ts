import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseAssessmentOutput, runAssessment } from "./assessor.js";
import type { Logger } from "@ultracoder/core";

describe("parseAssessmentOutput", () => {
	it("parses clean JSON output", () => {
		const output = JSON.stringify({
			severity: "high",
			effort: "small",
			rootCause: "Missing null check in handler",
			proposedFix: "Add guard clause at line 42",
			relatedFiles: ["src/handler.ts"],
			confidence: 0.85,
		});

		const result = parseAssessmentOutput(output);
		expect(result).not.toBeNull();
		expect(result!.severity).toBe("high");
		expect(result!.effort).toBe("small");
		expect(result!.rootCause).toBe("Missing null check in handler");
		expect(result!.proposedFix).toBe("Add guard clause at line 42");
		expect(result!.relatedFiles).toEqual(["src/handler.ts"]);
		expect(result!.confidence).toBe(0.85);
	});

	it("parses JSON from fenced code block", () => {
		const output = `Here's my analysis:

\`\`\`json
{
  "severity": "medium",
  "effort": "trivial",
  "rootCause": "Typo in variable name",
  "proposedFix": "Rename variable",
  "relatedFiles": ["src/utils.ts"],
  "confidence": 0.95
}
\`\`\`

That should fix it.`;

		const result = parseAssessmentOutput(output);
		expect(result).not.toBeNull();
		expect(result!.severity).toBe("medium");
		expect(result!.confidence).toBe(0.95);
	});

	it("parses JSON embedded in prose", () => {
		const output = `After analyzing the issue, I believe:

{ "severity": "low", "effort": "medium", "rootCause": "Race condition", "proposedFix": "Add mutex", "relatedFiles": [], "confidence": 0.6 }

This should resolve the problem.`;

		const result = parseAssessmentOutput(output);
		expect(result).not.toBeNull();
		expect(result!.severity).toBe("low");
		expect(result!.rootCause).toBe("Race condition");
	});

	it("returns null for non-JSON output", () => {
		const result = parseAssessmentOutput("This is just plain text with no JSON.");
		expect(result).toBeNull();
	});

	it("returns null for invalid JSON", () => {
		const result = parseAssessmentOutput("{ invalid json }");
		expect(result).toBeNull();
	});

	it("returns null for JSON missing required fields", () => {
		const result = parseAssessmentOutput(JSON.stringify({ severity: "high" }));
		expect(result).toBeNull();
	});

	it("defaults confidence to 0.5 if missing", () => {
		const output = JSON.stringify({
			severity: "high",
			effort: "small",
			rootCause: "Bug",
			proposedFix: "Fix it",
			relatedFiles: [],
		});

		const result = parseAssessmentOutput(output);
		expect(result).not.toBeNull();
		expect(result!.confidence).toBe(0.5);
	});

	it("returns null for invalid severity enum value", () => {
		const output = JSON.stringify({
			severity: "urgent",
			effort: "small",
			rootCause: "Bug",
			proposedFix: "Fix it",
			relatedFiles: [],
			confidence: 0.8,
		});
		expect(parseAssessmentOutput(output)).toBeNull();
	});

	it("returns null for invalid effort enum value", () => {
		const output = JSON.stringify({
			severity: "high",
			effort: "tiny",
			rootCause: "Bug",
			proposedFix: "Fix it",
			relatedFiles: [],
			confidence: 0.8,
		});
		expect(parseAssessmentOutput(output)).toBeNull();
	});

	it("normalizes case-insensitive severity/effort", () => {
		const output = JSON.stringify({
			severity: "High",
			effort: "Small",
			rootCause: "Bug",
			proposedFix: "Fix",
			relatedFiles: [],
			confidence: 0.8,
		});
		const result = parseAssessmentOutput(output);
		expect(result).not.toBeNull();
		expect(result!.severity).toBe("high");
		expect(result!.effort).toBe("small");
	});

	it("clamps confidence to 0-1 range", () => {
		const output = JSON.stringify({
			severity: "high",
			effort: "small",
			rootCause: "Bug",
			proposedFix: "Fix",
			relatedFiles: [],
			confidence: 5.0,
		});
		const result = parseAssessmentOutput(output);
		expect(result).not.toBeNull();
		expect(result!.confidence).toBe(1);

		const output2 = JSON.stringify({
			severity: "high",
			effort: "small",
			rootCause: "Bug",
			proposedFix: "Fix",
			relatedFiles: [],
			confidence: -0.5,
		});
		const result2 = parseAssessmentOutput(output2);
		expect(result2).not.toBeNull();
		expect(result2!.confidence).toBe(0);
	});

	it("defaults relatedFiles to empty array if not array", () => {
		const output = JSON.stringify({
			severity: "high",
			effort: "small",
			rootCause: "Bug",
			proposedFix: "Fix it",
			relatedFiles: "not-an-array",
			confidence: 0.7,
		});

		const result = parseAssessmentOutput(output);
		expect(result).not.toBeNull();
		expect(result!.relatedFiles).toEqual([]);
	});
});

// ── buildPrompt (tested indirectly via runAssessment) ────────────────

// We cannot import buildPrompt directly (not exported), but we can verify
// it through runAssessment by checking the arguments passed to execFile.

vi.mock("node:child_process", () => ({
	execFile: vi.fn(),
}));

vi.mock("node:util", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		promisify: (fn: unknown) => {
			// Return a mock that delegates to our mocked execFile
			return async (...args: unknown[]) => {
				const { execFile: mockExecFile } = await import("node:child_process");
				return new Promise((resolve, reject) => {
					(mockExecFile as unknown as (...a: unknown[]) => void)(...args, (err: unknown, stdout: string, stderr: string) => {
						if (err) reject(err);
						else resolve({ stdout, stderr });
					});
				});
			};
		},
	};
});

function makeLogger(): Logger {
	const noop = () => {};
	return {
		debug: noop,
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		child: () => makeLogger(),
	};
}

describe("runAssessment", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("builds prompt with issue id, title, and body", async () => {
		const { execFile } = await import("node:child_process");
		const mockExecFile = vi.mocked(execFile);
		const validOutput = JSON.stringify({
			severity: "high",
			effort: "small",
			rootCause: "Null check missing",
			proposedFix: "Add guard",
			relatedFiles: ["src/a.ts"],
			confidence: 0.9,
		});
		mockExecFile.mockImplementation((...args: unknown[]) => {
			const cb = args[args.length - 1] as (err: unknown, stdout: string, stderr: string) => void;
			cb(null, validOutput, "");
			return undefined as never;
		});

		await runAssessment("claude", "42", "Bug title", "Bug body text", {
			agentPath: "/usr/bin/agent",
			timeoutMs: 30000,
		}, makeLogger());

		// Verify execFile was called with the agent path
		expect(mockExecFile).toHaveBeenCalled();
		const callArgs = mockExecFile.mock.calls[0];
		// First arg is the binary path
		expect(callArgs[0]).toBe("/usr/bin/agent");
		// Second arg is the argument array containing the prompt
		const argArray = callArgs[1] as string[];
		expect(argArray[0]).toBe("-p");
		// The prompt should contain the issue details
		const prompt = argArray[1];
		expect(prompt).toContain("#42");
		expect(prompt).toContain("Bug title");
		expect(prompt).toContain("Bug body text");
	});

	it("passes maxBuffer of 10MB and configured timeout to execFile", async () => {
		const { execFile } = await import("node:child_process");
		const mockExecFile = vi.mocked(execFile);
		const validOutput = JSON.stringify({
			severity: "medium",
			effort: "medium",
			rootCause: "Race condition",
			proposedFix: "Add lock",
			relatedFiles: [],
			confidence: 0.7,
		});
		mockExecFile.mockImplementation((...args: unknown[]) => {
			const cb = args[args.length - 1] as (err: unknown, stdout: string, stderr: string) => void;
			cb(null, validOutput, "");
			return undefined as never;
		});

		await runAssessment("claude", "1", "Title", "Body", {
			agentPath: "/usr/bin/agent",
			timeoutMs: 60000,
		}, makeLogger());

		const callArgs = mockExecFile.mock.calls[0];
		const opts = callArgs[2] as { timeout: number; maxBuffer: number };
		expect(opts.timeout).toBe(60000);
		expect(opts.maxBuffer).toBe(10 * 1024 * 1024);
	});

	it("returns parsed assessment when agent output is valid JSON", async () => {
		const { execFile } = await import("node:child_process");
		const mockExecFile = vi.mocked(execFile);
		mockExecFile.mockImplementation((...args: unknown[]) => {
			const cb = args[args.length - 1] as (err: unknown, stdout: string, stderr: string) => void;
			cb(null, JSON.stringify({
				severity: "critical",
				effort: "large",
				rootCause: "Memory leak in event loop",
				proposedFix: "Dispose listeners properly",
				relatedFiles: ["src/events.ts", "src/loop.ts"],
				confidence: 0.92,
			}), "");
			return undefined as never;
		});

		const result = await runAssessment("claude", "99", "Mem leak", "OOM in prod", {
			agentPath: "/usr/bin/agent",
			timeoutMs: 30000,
		}, makeLogger());

		expect(result.agent).toBe("claude");
		expect(result.severity).toBe("critical");
		expect(result.effort).toBe("large");
		expect(result.rootCause).toBe("Memory leak in event loop");
		expect(result.proposedFix).toBe("Dispose listeners properly");
		expect(result.relatedFiles).toEqual(["src/events.ts", "src/loop.ts"]);
		expect(result.confidence).toBe(0.92);
		expect(result.completedAt).toBeDefined();
	});

	it("returns defaults when agent output is not parseable", async () => {
		const { execFile } = await import("node:child_process");
		const mockExecFile = vi.mocked(execFile);
		mockExecFile.mockImplementation((...args: unknown[]) => {
			const cb = args[args.length - 1] as (err: unknown, stdout: string, stderr: string) => void;
			cb(null, "I could not analyze this issue properly.", "");
			return undefined as never;
		});

		const result = await runAssessment("codex", "5", "Title", "Body", {
			agentPath: "/usr/bin/agent",
			timeoutMs: 30000,
		}, makeLogger());

		expect(result.agent).toBe("codex");
		expect(result.severity).toBe("medium");
		expect(result.effort).toBe("medium");
		expect(result.rootCause).toContain("not parseable");
		expect(result.confidence).toBe(0.1);
		expect(result.relatedFiles).toEqual([]);
	});

	it("throws when execFile fails", async () => {
		const { execFile } = await import("node:child_process");
		const mockExecFile = vi.mocked(execFile);
		mockExecFile.mockImplementation((...args: unknown[]) => {
			const cb = args[args.length - 1] as (err: unknown, stdout: string, stderr: string) => void;
			cb(new Error("Process exited with code 1"), "", "");
			return undefined as never;
		});

		await expect(
			runAssessment("claude", "7", "Title", "Body", {
				agentPath: "/usr/bin/agent",
				timeoutMs: 30000,
			}, makeLogger()),
		).rejects.toThrow("Assessment by claude failed: Process exited with code 1");
	});
});
