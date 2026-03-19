import type { Logger, ReviewOpts } from "@ultracoder/core";
import { describe, expect, it, vi } from "vitest";
import { type ReviewerConfig, parseReviewOutput, reviewDiff } from "./reviewer.js";

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

const baseOpts: ReviewOpts = {
	diff: "--- a/foo.ts\n+++ b/foo.ts\n@@ -1 +1 @@\n-old\n+new",
	task: "Fix the widget",
	sessionId: "sess-1",
};

// ─── parseReviewOutput ──────────────────────────────────────────────

describe("parseReviewOutput", () => {
	it("parses APPROVE verdict", () => {
		const output = "APPROVE\nChanges look good. Clean refactoring.";
		const result = parseReviewOutput(output);
		expect(result.decision).toBe("approve");
		expect(result.summary).toBe("Changes look good. Clean refactoring.");
		expect(result.comments).toHaveLength(0);
	});

	it("parses REQUEST_CHANGES verdict with comments", () => {
		const output = [
			"REQUEST_CHANGES",
			"There are issues that need to be addressed.",
			"COMMENT src/utils.ts:15 Consider adding a null check here.",
			"COMMENT src/index.ts:42 Missing error handling for edge case.",
		].join("\n");
		const result = parseReviewOutput(output);
		expect(result.decision).toBe("request_changes");
		expect(result.summary).toBe("There are issues that need to be addressed.");
		expect(result.comments).toHaveLength(2);
		expect(result.comments[0]).toEqual({
			file: "src/utils.ts",
			line: 15,
			body: "Consider adding a null check here.",
		});
		expect(result.comments[1]).toEqual({
			file: "src/index.ts",
			line: 42,
			body: "Missing error handling for edge case.",
		});
	});

	it("parses COMMENT verdict", () => {
		const output = "COMMENT\nSome minor suggestions but nothing blocking.";
		const result = parseReviewOutput(output);
		expect(result.decision).toBe("comment");
		expect(result.summary).toBe("Some minor suggestions but nothing blocking.");
		expect(result.comments).toHaveLength(0);
	});

	it("defaults to comment for malformed output", () => {
		const output = "This output doesn't follow the format at all.";
		const result = parseReviewOutput(output);
		expect(result.decision).toBe("comment");
		expect(result.summary).toBe("No summary provided");
		expect(result.comments).toHaveLength(0);
	});

	it("handles empty output", () => {
		const result = parseReviewOutput("");
		expect(result.decision).toBe("comment");
		expect(result.summary).toBe("No summary provided");
		expect(result.comments).toHaveLength(0);
	});
});

// ─── reviewDiff ─────────────────────────────────────────────────────

describe("reviewDiff", () => {
	it("returns null when disabled", async () => {
		const config: ReviewerConfig = { enabled: false };
		const result = await reviewDiff(baseOpts, config, makeLogger());
		expect(result).toBeNull();
	});

	it("returns a comment verdict on agent failure", async () => {
		const config: ReviewerConfig = {
			enabled: true,
			agentPath: "/nonexistent/binary",
			timeoutMs: 5000,
		};
		const logger = makeLogger();
		const result = await reviewDiff(baseOpts, config, logger);
		expect(result).not.toBeNull();
		expect(result!.decision).toBe("comment");
		expect(result!.summary).toContain("Reviewer error:");
		expect(result!.comments).toHaveLength(0);
		expect(logger.warn).toHaveBeenCalled();
	});
});
