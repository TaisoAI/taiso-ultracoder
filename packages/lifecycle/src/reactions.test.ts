import type { Logger, Session } from "@ultracoder/core";
import { describe, expect, it, vi } from "vitest";
import {
	DEFAULT_REACTION_CONFIG,
	type ReactionConfig,
	type TriggerMeta,
	evaluateReaction,
} from "./reactions.js";

function makeSession(overrides: Partial<Session> = {}): Session {
	return {
		id: "sess-1",
		task: "Fix the bug",
		status: "working",
		branch: "fix/bug",
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		...overrides,
	} as Session;
}

function makeLogger(): Logger {
	return {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	} as unknown as Logger;
}

describe("evaluateReaction", () => {
	const session = makeSession();
	const logger = makeLogger();

	// ─── Default behavior (no meta, no config) ────────────────────

	describe("default behavior without meta or config", () => {
		it("returns notify for ci_fail", () => {
			const action = evaluateReaction("ci_fail", session, logger);
			expect(action.type).toBe("notify");
		});

		it("returns notify for review_requested", () => {
			const action = evaluateReaction("review_requested", session, logger);
			expect(action.type).toBe("notify");
		});

		it("returns pause for conflict", () => {
			const action = evaluateReaction("conflict", session, logger);
			expect(action.type).toBe("pause");
		});

		it("returns resume for stuck", () => {
			const action = evaluateReaction("stuck", session, logger);
			expect(action.type).toBe("resume");
		});

		it("returns notify for completed", () => {
			const action = evaluateReaction("completed", session, logger);
			expect(action.type).toBe("notify");
		});
	});

	// ─── Retry count escalation ────────────────────────────────────

	describe("retry count exceeding maxRetries", () => {
		it("escalates ci_fail when retryCount >= maxRetries (2)", () => {
			const meta: TriggerMeta = { retryCount: 2 };
			const action = evaluateReaction("ci_fail", session, logger, undefined, meta);
			expect(action).toEqual({ type: "escalate", to: "human" });
		});

		it("escalates ci_fail when retryCount exceeds maxRetries", () => {
			const meta: TriggerMeta = { retryCount: 5 };
			const action = evaluateReaction("ci_fail", session, logger, undefined, meta);
			expect(action).toEqual({ type: "escalate", to: "human" });
		});

		it("does not escalate ci_fail when retryCount < maxRetries", () => {
			const meta: TriggerMeta = { retryCount: 1 };
			const action = evaluateReaction("ci_fail", session, logger, undefined, meta);
			expect(action.type).toBe("notify");
		});

		it("escalates conflict when retryCount >= maxRetries (1)", () => {
			const meta: TriggerMeta = { retryCount: 1 };
			const action = evaluateReaction("conflict", session, logger, undefined, meta);
			expect(action).toEqual({ type: "escalate", to: "human" });
		});

		it("escalates stuck when retryCount >= maxRetries (1)", () => {
			const meta: TriggerMeta = { retryCount: 1 };
			const action = evaluateReaction("stuck", session, logger, undefined, meta);
			expect(action).toEqual({ type: "escalate", to: "human" });
		});

		it("does not escalate review_requested (maxRetries is 0, meaning no retry-based escalation)", () => {
			const meta: TriggerMeta = { retryCount: 10 };
			const action = evaluateReaction("review_requested", session, logger, undefined, meta);
			expect(action.type).toBe("notify");
		});

		it("does not escalate completed (maxRetries is 0)", () => {
			const meta: TriggerMeta = { retryCount: 10 };
			const action = evaluateReaction("completed", session, logger, undefined, meta);
			expect(action.type).toBe("notify");
		});
	});

	// ─── Time-based escalation ─────────────────────────────────────

	describe("time exceeding escalateAfterMs", () => {
		it("escalates ci_fail after 30 minutes", () => {
			const thirtyOneMinAgo = new Date(Date.now() - 31 * 60 * 1000).toISOString();
			const meta: TriggerMeta = { firstDetectedAt: thirtyOneMinAgo };
			const action = evaluateReaction("ci_fail", session, logger, undefined, meta);
			expect(action).toEqual({ type: "escalate", to: "human" });
		});

		it("does not escalate ci_fail before 30 minutes", () => {
			const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
			const meta: TriggerMeta = { firstDetectedAt: fiveMinAgo };
			const action = evaluateReaction("ci_fail", session, logger, undefined, meta);
			expect(action.type).toBe("notify");
		});

		it("escalates conflict after 15 minutes", () => {
			const sixteenMinAgo = new Date(Date.now() - 16 * 60 * 1000).toISOString();
			const meta: TriggerMeta = { firstDetectedAt: sixteenMinAgo };
			const action = evaluateReaction("conflict", session, logger, undefined, meta);
			expect(action).toEqual({ type: "escalate", to: "human" });
		});

		it("escalates stuck after 10 minutes", () => {
			const elevenMinAgo = new Date(Date.now() - 11 * 60 * 1000).toISOString();
			const meta: TriggerMeta = { firstDetectedAt: elevenMinAgo };
			const action = evaluateReaction("stuck", session, logger, undefined, meta);
			expect(action).toEqual({ type: "escalate", to: "human" });
		});

		it("does not escalate review_requested (escalateAfterMs is 0)", () => {
			const longAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
			const meta: TriggerMeta = { firstDetectedAt: longAgo };
			const action = evaluateReaction("review_requested", session, logger, undefined, meta);
			expect(action.type).toBe("notify");
		});

		it("does not escalate completed (escalateAfterMs is 0)", () => {
			const longAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
			const meta: TriggerMeta = { firstDetectedAt: longAgo };
			const action = evaluateReaction("completed", session, logger, undefined, meta);
			expect(action.type).toBe("notify");
		});
	});

	// ─── Custom config ─────────────────────────────────────────────

	describe("custom config overriding defaults", () => {
		it("uses custom maxRetries for ci_fail", () => {
			const customConfig: ReactionConfig = {
				...DEFAULT_REACTION_CONFIG,
				ci_fail: { maxRetries: 5, escalateAfterMs: 1800000 },
			};
			// retryCount 3 is below custom max of 5 — should NOT escalate
			const meta: TriggerMeta = { retryCount: 3 };
			const action = evaluateReaction("ci_fail", session, logger, customConfig, meta);
			expect(action.type).toBe("notify");

			// retryCount 5 meets custom max — SHOULD escalate
			const meta2: TriggerMeta = { retryCount: 5 };
			const action2 = evaluateReaction("ci_fail", session, logger, customConfig, meta2);
			expect(action2).toEqual({ type: "escalate", to: "human" });
		});

		it("uses custom escalateAfterMs for stuck", () => {
			const customConfig: ReactionConfig = {
				...DEFAULT_REACTION_CONFIG,
				stuck: { maxRetries: 1, escalateAfterMs: 60000 }, // 1 minute
			};
			const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
			const meta: TriggerMeta = { firstDetectedAt: twoMinAgo };
			const action = evaluateReaction("stuck", session, logger, customConfig, meta);
			expect(action).toEqual({ type: "escalate", to: "human" });
		});
	});

	// ─── DEFAULT_REACTION_CONFIG sanity check ──────────────────────

	describe("DEFAULT_REACTION_CONFIG", () => {
		it("has expected defaults", () => {
			expect(DEFAULT_REACTION_CONFIG.ci_fail).toEqual({ maxRetries: 2, escalateAfterMs: 1800000 });
			expect(DEFAULT_REACTION_CONFIG.review_requested).toEqual({
				maxRetries: 0,
				escalateAfterMs: 0,
			});
			expect(DEFAULT_REACTION_CONFIG.conflict).toEqual({ maxRetries: 1, escalateAfterMs: 900000 });
			expect(DEFAULT_REACTION_CONFIG.stuck).toEqual({ maxRetries: 1, escalateAfterMs: 600000 });
			expect(DEFAULT_REACTION_CONFIG.completed).toEqual({ maxRetries: 0, escalateAfterMs: 0 });
		});
	});
});
