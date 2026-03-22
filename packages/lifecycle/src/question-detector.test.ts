import type { Logger } from "@ultracoder/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { detectQuestion, tryAutoAnswer } from "./question-detector.js";

// ─── Mock child_process ──────────────────────────────────────────────

vi.mock("node:child_process", () => {
	const execFileFn = vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
		cb(null, { stdout: "", stderr: "" });
	});
	return { execFile: execFileFn };
});

import { execFile as execFileCb } from "node:child_process";
const mockExecFile = vi.mocked(execFileCb);

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

function setupExecFileResponse(stdout: string) {
	mockExecFile.mockImplementation(
		(_cmd: string, _args: readonly string[], _opts: unknown, cb: Function) => {
			cb(null, { stdout, stderr: "" });
			return undefined as any;
		},
	);
}

function setupExecFileError(error: Error) {
	mockExecFile.mockImplementation(
		(_cmd: string, _args: readonly string[], _opts: unknown, cb: Function) => {
			cb(error, { stdout: "", stderr: "" });
			return undefined as any;
		},
	);
}

// ─── Tests: detectQuestion ──────────────────────────────────────────

describe("detectQuestion", () => {
	it("detects 'Should I' as a question with high confidence", () => {
		const result = detectQuestion("Should I use TypeScript or JavaScript?");
		expect(result.isQuestion).toBe(true);
		expect(result.confidence).toBeGreaterThanOrEqual(0.8);
		expect(result.questionText).toContain("Should I");
	});

	it("returns isQuestion=false for non-question text", () => {
		const result = detectQuestion("Implementing the feature now");
		expect(result.isQuestion).toBe(false);
		expect(result.confidence).toBe(0);
		expect(result.questionText).toBe("");
	});

	it("detects 'I need clarification' as a question", () => {
		const result = detectQuestion("I need clarification on the database schema");
		expect(result.isQuestion).toBe(true);
		expect(result.confidence).toBe(0.9);
	});

	it("returns isQuestion=false for short text ending with ?", () => {
		const result = detectQuestion("What?");
		expect(result.isQuestion).toBe(false);
		expect(result.confidence).toBe(0);
	});

	it("detects 'Do you want' in multi-sentence text", () => {
		const result = detectQuestion(
			"I've updated the configuration file. Do you want me to also update the tests?",
		);
		expect(result.isQuestion).toBe(true);
		expect(result.confidence).toBeGreaterThanOrEqual(0.9);
	});

	it("detects trailing ? on substantial content with lower confidence", () => {
		const result = detectQuestion(
			"The build system uses webpack for bundling, is that correct for this project?",
		);
		// No keyword pattern matches, but > 20 chars with trailing ?
		expect(result.isQuestion).toBe(true);
		expect(result.confidence).toBe(0.5);
	});

	it("returns highest confidence when multiple patterns match", () => {
		const result = detectQuestion("Should I proceed? Do you want me to continue?");
		expect(result.isQuestion).toBe(true);
		expect(result.confidence).toBe(0.9);
	});
});

// ─── Tests: tryAutoAnswer ───────────────────────────────────────────

describe("tryAutoAnswer", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns answered=true with the response when agent provides an answer", async () => {
		setupExecFileResponse("Use TypeScript");

		const result = await tryAutoAnswer({
			question: "Should I use TypeScript or JavaScript?",
			taskContext: "Building a new Node.js service",
			logger: makeLogger(),
		});

		expect(result.answered).toBe(true);
		expect(result.answer).toBe("Use TypeScript");
	});

	it("returns answered=false when agent responds with ESCALATE", async () => {
		setupExecFileResponse("ESCALATE");

		const result = await tryAutoAnswer({
			question: "Which database should we use?",
			taskContext: "Building a new service",
			logger: makeLogger(),
		});

		expect(result.answered).toBe(false);
		expect(result.answer).toBeNull();
	});

	it("returns answered=false on error (graceful degradation)", async () => {
		setupExecFileError(new Error("command not found"));

		const logger = makeLogger();
		const result = await tryAutoAnswer({
			question: "Should I refactor this?",
			taskContext: "Fixing a bug",
			logger,
		});

		expect(result.answered).toBe(false);
		expect(result.answer).toBeNull();
	});

	it("uses custom agentPath when provided", async () => {
		setupExecFileResponse("Yes, proceed");

		await tryAutoAnswer({
			question: "Should I proceed?",
			taskContext: "Task context",
			agentPath: "/usr/local/bin/my-agent",
			logger: makeLogger(),
		});

		expect(mockExecFile).toHaveBeenCalledWith(
			"/usr/local/bin/my-agent",
			expect.arrayContaining(["-p"]),
			expect.objectContaining({ timeout: 60_000 }),
			expect.any(Function),
		);
	});

	it("trims whitespace from agent response", async () => {
		setupExecFileResponse("  Use TypeScript  \n");

		const result = await tryAutoAnswer({
			question: "Which language?",
			taskContext: "Context",
			logger: makeLogger(),
		});

		expect(result.answer).toBe("Use TypeScript");
	});
});
