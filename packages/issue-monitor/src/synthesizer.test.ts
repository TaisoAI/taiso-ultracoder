import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Logger } from "@ultracoder/core";
import type { IssueRecord, AgentAssessment } from "./types.js";

vi.mock("node:child_process", () => ({
	execFile: vi.fn(),
}));

vi.mock("node:util", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		promisify: (fn: unknown) => {
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
	return {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		child: vi.fn().mockReturnThis(),
	};
}

function makeAssessment(agent: string, overrides: Partial<AgentAssessment> = {}): AgentAssessment {
	return {
		agent,
		severity: "high",
		effort: "small",
		rootCause: "Null pointer in handler",
		proposedFix: "Add null check",
		relatedFiles: ["src/handler.ts"],
		confidence: 0.9,
		completedAt: new Date().toISOString(),
		...overrides,
	};
}

function makeRecord(overrides: Partial<IssueRecord> = {}): IssueRecord {
	return {
		issueId: "42",
		issueUrl: "https://github.com/test/repo/issues/42",
		title: "Crash on login",
		body: "The app crashes when a user tries to login with SSO.",
		state: "assessed",
		firstSeenAt: new Date().toISOString(),
		lastCheckedAt: new Date().toISOString(),
		assessments: {
			claude: makeAssessment("claude-opus-4-6"),
			codex: makeAssessment("codex", {
				rootCause: "Unhandled promise rejection in SSO flow",
				proposedFix: "Wrap async call in try-catch",
				relatedFiles: ["src/sso.ts"],
			}),
		},
		...overrides,
	};
}

function mockExecFileSuccess(stdout: string) {
	return async () => {
		const { execFile } = await import("node:child_process");
		vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
			const cb = args[args.length - 1] as (err: unknown, stdout: string, stderr: string) => void;
			cb(null, stdout, "");
			return undefined as never;
		});
	};
}

function mockExecFileFailure(error: Error) {
	return async () => {
		const { execFile } = await import("node:child_process");
		vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
			const cb = args[args.length - 1] as (err: unknown, stdout: string, stderr: string) => void;
			cb(error, "", "");
			return undefined as never;
		});
	};
}

describe("synthesizePlan", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("builds prompt with issue details and both assessments", async () => {
		await mockExecFileSuccess("Fix the null check in handler.ts line 42.")();
		const { synthesizePlan } = await import("./synthesizer.js");
		const { execFile } = await import("node:child_process");

		const record = makeRecord();
		await synthesizePlan(record, { agentPath: "/usr/bin/claude", timeoutMs: 60000 }, makeLogger());

		const calls = vi.mocked(execFile).mock.calls;
		expect(calls.length).toBe(1);
		const argArray = calls[0][1] as string[];
		const prompt = argArray[1];

		// Prompt should contain issue details
		expect(prompt).toContain("#42");
		expect(prompt).toContain("Crash on login");
		expect(prompt).toContain("The app crashes when a user tries to login with SSO.");

		// Prompt should contain both assessments
		expect(prompt).toContain("claude-opus-4-6");
		expect(prompt).toContain("Null pointer in handler");
		expect(prompt).toContain("codex");
		expect(prompt).toContain("Unhandled promise rejection in SSO flow");
	});

	it("returns trimmed plan from agent stdout", async () => {
		const plan = "  1. Fix null check in handler.ts\n2. Add test for SSO flow  ";
		await mockExecFileSuccess(plan)();
		const { synthesizePlan } = await import("./synthesizer.js");

		const result = await synthesizePlan(
			makeRecord(),
			{ agentPath: "claude", timeoutMs: 60000 },
			makeLogger(),
		);

		expect(result).toBe(plan.trim());
	});

	it("throws on empty synthesis output", async () => {
		await mockExecFileSuccess("   ")();
		const { synthesizePlan } = await import("./synthesizer.js");

		await expect(
			synthesizePlan(makeRecord(), { agentPath: "claude", timeoutMs: 60000 }, makeLogger()),
		).rejects.toThrow("Empty synthesis output");
	});

	it("throws with wrapped message when execFile fails", async () => {
		await mockExecFileFailure(new Error("Agent process killed"))();
		const { synthesizePlan } = await import("./synthesizer.js");

		await expect(
			synthesizePlan(makeRecord(), { agentPath: "claude", timeoutMs: 60000 }, makeLogger()),
		).rejects.toThrow("Plan synthesis failed: Agent process killed");
	});

	it("passes maxBuffer and timeout to execFile", async () => {
		await mockExecFileSuccess("A plan.")();
		const { synthesizePlan } = await import("./synthesizer.js");
		const { execFile } = await import("node:child_process");

		await synthesizePlan(
			makeRecord(),
			{ agentPath: "/usr/bin/claude", timeoutMs: 120000 },
			makeLogger(),
		);

		const opts = vi.mocked(execFile).mock.calls[0][2] as { timeout: number; maxBuffer: number };
		expect(opts.timeout).toBe(120000);
		expect(opts.maxBuffer).toBe(10 * 1024 * 1024);
	});

	it("uses --output-format text flag", async () => {
		await mockExecFileSuccess("Plan text.")();
		const { synthesizePlan } = await import("./synthesizer.js");
		const { execFile } = await import("node:child_process");

		await synthesizePlan(
			makeRecord(),
			{ agentPath: "claude", timeoutMs: 60000 },
			makeLogger(),
		);

		const argArray = vi.mocked(execFile).mock.calls[0][1] as string[];
		expect(argArray).toContain("--output-format");
		expect(argArray).toContain("text");
	});

	it("handles record with only Claude assessment (codex unavailable)", async () => {
		await mockExecFileSuccess("Plan based on Claude only.")();
		const { synthesizePlan } = await import("./synthesizer.js");
		const { execFile } = await import("node:child_process");

		const record = makeRecord({
			assessments: {
				claude: makeAssessment("claude-opus-4-6"),
			},
		});

		const result = await synthesizePlan(
			record,
			{ agentPath: "claude", timeoutMs: 60000 },
			makeLogger(),
		);

		expect(result).toBe("Plan based on Claude only.");
		const prompt = (vi.mocked(execFile).mock.calls[0][1] as string[])[1];
		expect(prompt).toContain("(not available)");
	});

	it("handles record with only Codex assessment (Claude unavailable)", async () => {
		await mockExecFileSuccess("Plan based on Codex only.")();
		const { synthesizePlan } = await import("./synthesizer.js");
		const { execFile } = await import("node:child_process");

		const record = makeRecord({
			assessments: {
				codex: makeAssessment("codex"),
			},
		});

		await synthesizePlan(
			record,
			{ agentPath: "claude", timeoutMs: 60000 },
			makeLogger(),
		);

		const prompt = (vi.mocked(execFile).mock.calls[0][1] as string[])[1];
		// Claude assessment should show as not available
		expect(prompt).toContain("(not available)");
		// Codex assessment should be present
		expect(prompt).toContain("codex");
	});

	it("logs synthesis completion with plan length", async () => {
		const plan = "Fix the bug by adding a null check.";
		await mockExecFileSuccess(plan)();
		const { synthesizePlan } = await import("./synthesizer.js");

		const logger = makeLogger();
		await synthesizePlan(
			makeRecord(),
			{ agentPath: "claude", timeoutMs: 60000 },
			logger,
		);

		expect(logger.info).toHaveBeenCalledWith("Synthesis complete", { planLength: plan.length });
	});
});
