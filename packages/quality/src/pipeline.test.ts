import type { Logger, ReviewVerdict } from "@ultracoder/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatesResult } from "./gates.js";
import type { VeracityFinding } from "./veracity.js";

// ── Mocks ─────────────────────────────────────────────────────────────

vi.mock("./veracity.js", () => ({
	checkVeracity: vi.fn(async () => []),
	checkVeracityFilesystem: vi.fn(async () => []),
}));

vi.mock("./tool-policy.js", () => ({
	evaluateToolPolicy: vi.fn(() => ({ tool: "test", tier: "auto", allowed: true })),
}));

vi.mock("./gates.js", () => ({
	runGates: vi.fn(async () => ({ passed: true, results: [] })),
}));

vi.mock("./reviewer.js", () => ({
	reviewDiff: vi.fn(async () => ({
		decision: "approve",
		summary: "Looks good",
		comments: [],
	})),
}));

import { runQualityPipeline } from "./pipeline.js";
import { runGates } from "./gates.js";
import { reviewDiff } from "./reviewer.js";
import { evaluateToolPolicy } from "./tool-policy.js";
import { checkVeracity, checkVeracityFilesystem } from "./veracity.js";

// ── Helpers ───────────────────────────────────────────────────────────

function makeLogger(): Logger {
	const noop = () => {};
	return {
		debug: noop,
		info: noop,
		warn: vi.fn(),
		error: noop,
		child: () => makeLogger(),
	};
}

function makeConfig() {
	return {
		veracity: { enabled: true, tier: "both" as const },
		toolPolicy: { enabled: true, defaultTier: "auto" as const },
		gates: { lint: true, test: true, typecheck: true },
		reviewer: { enabled: true },
	};
}

describe("runQualityPipeline", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns passed when all stages succeed with no issues", async () => {
		const result = await runQualityPipeline(
			{ projectPath: "/tmp/project" },
			makeConfig(),
			makeLogger(),
		);

		expect(result.passed).toBe(true);
		expect(result.errors).toHaveLength(0);
		expect(result.veracity).toEqual([]);
		expect(result.filesystemVeracity).toEqual([]);
		expect(result.toolPolicyDecisions).toEqual([]);
	});

	// ── Error stringification ─────────────────────────────────────────

	it("stringifies Error instances correctly in veracity stage", async () => {
		vi.mocked(checkVeracity).mockRejectedValueOnce(new Error("LLM timed out"));

		const result = await runQualityPipeline(
			{ content: "some content", projectPath: "/tmp/project" },
			makeConfig(),
			makeLogger(),
		);

		expect(result.passed).toBe(false);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toBe("Veracity check failed: LLM timed out");
		// Ensures we use err.message, not the old `${err}` which would produce "Error: LLM timed out"
		expect(result.errors[0]).not.toContain("Error: Error:");
	});

	it("stringifies non-Error values correctly in veracity stage", async () => {
		vi.mocked(checkVeracity).mockRejectedValueOnce("plain string error");

		const result = await runQualityPipeline(
			{ content: "some content", projectPath: "/tmp/project" },
			makeConfig(),
			makeLogger(),
		);

		expect(result.passed).toBe(false);
		expect(result.errors[0]).toBe("Veracity check failed: plain string error");
	});

	it("stringifies Error instances correctly in filesystem veracity stage", async () => {
		vi.mocked(checkVeracityFilesystem).mockRejectedValueOnce(
			new Error("git not found"),
		);

		const result = await runQualityPipeline(
			{ projectPath: "/tmp/project" },
			makeConfig(),
			makeLogger(),
		);

		expect(result.passed).toBe(false);
		expect(result.errors[0]).toBe("Filesystem veracity check failed: git not found");
	});

	it("stringifies Error instances correctly in gates stage", async () => {
		vi.mocked(runGates).mockRejectedValueOnce(new Error("lint crashed"));

		const result = await runQualityPipeline(
			{ projectPath: "/tmp/project" },
			makeConfig(),
			makeLogger(),
		);

		expect(result.passed).toBe(false);
		expect(result.errors[0]).toBe("Quality gates failed: lint crashed");
	});

	it("stringifies Error instances correctly in reviewer stage", async () => {
		vi.mocked(reviewDiff).mockRejectedValueOnce(new Error("model unavailable"));

		const result = await runQualityPipeline(
			{
				projectPath: "/tmp/project",
				diff: "--- a\n+++ b",
				task: "fix bug",
				sessionId: "s-1",
			},
			makeConfig(),
			makeLogger(),
		);

		expect(result.passed).toBe(false);
		expect(result.errors[0]).toBe("Reviewer failed: model unavailable");
	});

	// ── Stage aggregation ─────────────────────────────────────────────

	it("skips veracity check when content is not provided", async () => {
		await runQualityPipeline(
			{ projectPath: "/tmp/project" },
			makeConfig(),
			makeLogger(),
		);

		expect(checkVeracity).not.toHaveBeenCalled();
	});

	it("runs veracity check when content is provided", async () => {
		const findings: VeracityFinding[] = [
			{ tier: "regex", message: "URL reference", severity: "warn" },
		];
		vi.mocked(checkVeracity).mockResolvedValueOnce(findings);

		const result = await runQualityPipeline(
			{ content: "see https://example.com", projectPath: "/tmp/project" },
			makeConfig(),
			makeLogger(),
		);

		expect(checkVeracity).toHaveBeenCalled();
		expect(result.veracity).toEqual(findings);
		expect(result.passed).toBe(true); // warn severity does not fail
	});

	it("fails when veracity has error-severity findings", async () => {
		vi.mocked(checkVeracity).mockResolvedValueOnce([
			{ tier: "regex", message: "Fabricated API", severity: "error" },
		]);

		const result = await runQualityPipeline(
			{ content: "hallucinated content", projectPath: "/tmp/project" },
			makeConfig(),
			makeLogger(),
		);

		expect(result.passed).toBe(false);
	});

	it("fails when filesystem veracity has error-severity findings", async () => {
		vi.mocked(checkVeracityFilesystem).mockResolvedValueOnce([
			{
				tier: "filesystem",
				message: "File not found in git diff",
				file: "ghost.ts",
				severity: "error",
			},
		]);

		const result = await runQualityPipeline(
			{ projectPath: "/tmp/project", claimedFiles: ["ghost.ts"] },
			makeConfig(),
			makeLogger(),
		);

		expect(result.passed).toBe(false);
		expect(result.filesystemVeracity).toHaveLength(1);
	});

	it("evaluates tool policy for each tool call", async () => {
		vi.mocked(evaluateToolPolicy)
			.mockReturnValueOnce({ tool: "bash:ls", tier: "auto", allowed: true })
			.mockReturnValueOnce({ tool: "write:*.env", tier: "blocked", allowed: false, reason: "Secrets" });

		const result = await runQualityPipeline(
			{ projectPath: "/tmp/project", toolCalls: ["bash:ls", "write:*.env"] },
			makeConfig(),
			makeLogger(),
		);

		expect(evaluateToolPolicy).toHaveBeenCalledTimes(2);
		expect(result.toolPolicyDecisions).toHaveLength(2);
		expect(result.passed).toBe(false); // blocked tool
	});

	it("skips tool policy when no toolCalls provided", async () => {
		await runQualityPipeline(
			{ projectPath: "/tmp/project" },
			makeConfig(),
			makeLogger(),
		);

		expect(evaluateToolPolicy).not.toHaveBeenCalled();
	});

	it("aggregates gates result", async () => {
		const gatesResult: GatesResult = {
			passed: false,
			results: [
				{ gate: "lint", passed: false, output: "3 errors", durationMs: 100 },
			],
		};
		vi.mocked(runGates).mockResolvedValueOnce(gatesResult);

		const result = await runQualityPipeline(
			{ projectPath: "/tmp/project" },
			makeConfig(),
			makeLogger(),
		);

		expect(result.passed).toBe(false);
		expect(result.gates).toEqual(gatesResult);
	});

	it("skips reviewer when diff/task/sessionId are not all provided", async () => {
		await runQualityPipeline(
			{ projectPath: "/tmp/project", diff: "some diff" }, // missing task & sessionId
			makeConfig(),
			makeLogger(),
		);

		expect(reviewDiff).not.toHaveBeenCalled();
	});

	it("runs reviewer when diff, task, and sessionId are all provided", async () => {
		const verdict: ReviewVerdict = {
			decision: "approve",
			summary: "LGTM",
			comments: [],
		};
		vi.mocked(reviewDiff).mockResolvedValueOnce(verdict);

		const result = await runQualityPipeline(
			{
				projectPath: "/tmp/project",
				diff: "--- a\n+++ b",
				task: "fix bug",
				sessionId: "s-1",
			},
			makeConfig(),
			makeLogger(),
		);

		expect(reviewDiff).toHaveBeenCalled();
		expect(result.review).toEqual(verdict);
		expect(result.passed).toBe(true);
	});

	it("fails when reviewer requests changes", async () => {
		vi.mocked(reviewDiff).mockResolvedValueOnce({
			decision: "request_changes",
			summary: "Missing tests",
			comments: [],
		});

		const result = await runQualityPipeline(
			{
				projectPath: "/tmp/project",
				diff: "--- a\n+++ b",
				task: "fix bug",
				sessionId: "s-1",
			},
			makeConfig(),
			makeLogger(),
		);

		expect(result.passed).toBe(false);
	});

	it("passes when reviewer comments (non-blocking)", async () => {
		vi.mocked(reviewDiff).mockResolvedValueOnce({
			decision: "comment",
			summary: "Minor nit",
			comments: [],
		});

		const result = await runQualityPipeline(
			{
				projectPath: "/tmp/project",
				diff: "--- a\n+++ b",
				task: "fix bug",
				sessionId: "s-1",
			},
			makeConfig(),
			makeLogger(),
		);

		expect(result.passed).toBe(true);
	});

	it("collects errors from multiple failing stages", async () => {
		vi.mocked(checkVeracity).mockRejectedValueOnce(new Error("veracity boom"));
		vi.mocked(checkVeracityFilesystem).mockRejectedValueOnce(new Error("fs boom"));
		vi.mocked(runGates).mockRejectedValueOnce(new Error("gates boom"));

		const result = await runQualityPipeline(
			{ content: "x", projectPath: "/tmp/project" },
			makeConfig(),
			makeLogger(),
		);

		expect(result.passed).toBe(false);
		expect(result.errors).toHaveLength(3);
		expect(result.errors).toContain("Veracity check failed: veracity boom");
		expect(result.errors).toContain("Filesystem veracity check failed: fs boom");
		expect(result.errors).toContain("Quality gates failed: gates boom");
	});

	it("logs a warning when a tool is blocked by policy", async () => {
		vi.mocked(evaluateToolPolicy).mockReturnValueOnce({
			tool: "write:.env",
			tier: "blocked",
			allowed: false,
			reason: "Secrets file",
		});
		const logger = makeLogger();

		await runQualityPipeline(
			{ projectPath: "/tmp/project", toolCalls: ["write:.env"] },
			makeConfig(),
			logger,
		);

		expect(logger.warn).toHaveBeenCalledWith(
			"Tool blocked by policy: write:.env",
			{ reason: "Secrets file" },
		);
	});
});
