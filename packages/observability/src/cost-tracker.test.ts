import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { appendJsonl } from "@ultracoder/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CostBudget, CostEntry } from "./cost-tracker.js";
import { calculateCost, isWithinBudget, recordCost, summarizeCosts } from "./cost-tracker.js";

describe("cost-tracker", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "uc-cost-"));
	});

	afterEach(async () => {
		await fs.promises.rm(tmpDir, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	describe("calculateCost", () => {
		it("calculates cost for a known model", () => {
			const cost = calculateCost("gpt-4o", 1_000_000, 1_000_000);
			// input: 2.5, output: 10.0 → 12.5
			expect(cost).toBeCloseTo(12.5);
		});

		it("returns 0 for unknown model", () => {
			expect(calculateCost("unknown-model", 100, 100)).toBe(0);
		});
	});

	describe("isWithinBudget", () => {
		const budget: CostBudget = {
			maxPerSession: 10,
			maxPerDay: 50,
			currency: "USD",
		};

		it("allows when session cost is within budget (no log path)", async () => {
			const result = await isWithinBudget(5, budget);
			expect(result.allowed).toBe(true);
			expect(result.remaining).toBe(5);
			expect(result.dailyCost).toBeUndefined();
		});

		it("denies when session cost exceeds budget", async () => {
			const result = await isWithinBudget(10, budget);
			expect(result.allowed).toBe(false);
			expect(result.remaining).toBe(0);
		});

		it("denies when session cost exceeds budget (over)", async () => {
			const result = await isWithinBudget(15, budget);
			expect(result.allowed).toBe(false);
			expect(result.remaining).toBe(0);
		});

		it("checks per-day budget from cost log", async () => {
			const logPath = path.join(tmpDir, "costs.jsonl");
			const today = new Date().toISOString().slice(0, 10);

			// Write 40 USD of costs for today
			for (let i = 0; i < 4; i++) {
				await appendJsonl(logPath, {
					sessionId: `s-${i}`,
					timestamp: `${today}T12:00:00.000Z`,
					model: "gpt-4o",
					inputTokens: 1000,
					outputTokens: 1000,
					cost: 10,
					currency: "USD",
				} satisfies CostEntry);
			}

			const result = await isWithinBudget(5, budget, logPath);
			expect(result.allowed).toBe(true);
			expect(result.dailyCost).toBe(40);
			// remaining should be min(session remaining=5, day remaining=10)
			expect(result.remaining).toBe(5);
		});

		it("denies when daily budget is exhausted", async () => {
			const logPath = path.join(tmpDir, "costs.jsonl");
			const today = new Date().toISOString().slice(0, 10);

			// Write 50 USD (exactly at daily limit)
			for (let i = 0; i < 5; i++) {
				await appendJsonl(logPath, {
					sessionId: `s-${i}`,
					timestamp: `${today}T12:00:00.000Z`,
					model: "gpt-4o",
					inputTokens: 1000,
					outputTokens: 1000,
					cost: 10,
					currency: "USD",
				} satisfies CostEntry);
			}

			const result = await isWithinBudget(1, budget, logPath);
			expect(result.allowed).toBe(false);
			expect(result.remaining).toBe(0);
			expect(result.dailyCost).toBe(50);
		});

		it("ignores entries from other days", async () => {
			const logPath = path.join(tmpDir, "costs.jsonl");

			// Write costs for yesterday
			await appendJsonl(logPath, {
				sessionId: "s-old",
				timestamp: "2020-01-01T12:00:00.000Z",
				model: "gpt-4o",
				inputTokens: 1000,
				outputTokens: 1000,
				cost: 100,
				currency: "USD",
			} satisfies CostEntry);

			const result = await isWithinBudget(5, budget, logPath);
			expect(result.allowed).toBe(true);
			expect(result.dailyCost).toBe(0);
			expect(result.remaining).toBe(5);
		});

		it("returns daily remaining when it is less than session remaining", async () => {
			const logPath = path.join(tmpDir, "costs.jsonl");
			const today = new Date().toISOString().slice(0, 10);

			// 48 USD spent today, 2 remaining for day
			for (let i = 0; i < 48; i++) {
				await appendJsonl(logPath, {
					sessionId: `s-${i}`,
					timestamp: `${today}T12:00:00.000Z`,
					model: "gpt-4o",
					inputTokens: 100,
					outputTokens: 100,
					cost: 1,
					currency: "USD",
				} satisfies CostEntry);
			}

			// session remaining = 10 - 1 = 9, day remaining = 50 - 48 = 2
			const result = await isWithinBudget(1, budget, logPath);
			expect(result.allowed).toBe(true);
			expect(result.remaining).toBe(2); // min(9, 2)
			expect(result.dailyCost).toBe(48);
		});

		it("skips per-day check when maxPerDay is 0", async () => {
			const noDayBudget: CostBudget = {
				maxPerSession: 10,
				maxPerDay: 0,
				currency: "USD",
			};
			const logPath = path.join(tmpDir, "costs.jsonl");

			const result = await isWithinBudget(5, noDayBudget, logPath);
			expect(result.allowed).toBe(true);
			expect(result.remaining).toBe(5);
			expect(result.dailyCost).toBeUndefined();
		});

		it("handles empty cost log file", async () => {
			const logPath = path.join(tmpDir, "costs.jsonl");
			await fs.promises.writeFile(logPath, "");

			const result = await isWithinBudget(5, budget, logPath);
			expect(result.allowed).toBe(true);
			expect(result.dailyCost).toBe(0);
		});
	});
});
