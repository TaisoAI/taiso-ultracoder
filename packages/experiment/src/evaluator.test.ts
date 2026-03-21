import { describe, expect, it } from "vitest";
import { evaluate } from "./evaluator.js";
import type { ExperimentIteration, MetricConfig } from "./types.js";

const baseConfig: MetricConfig = {
	name: "coverage",
	command: "test",
	extract: "$.coverage",
	direction: "up",
};

function makeIteration(overrides: Partial<ExperimentIteration> & { value: number }): ExperimentIteration {
	return {
		iteration: 1,
		delta: 0,
		kept: false,
		timestamp: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

describe("evaluate", () => {
	it("always keeps the first measurement (baseline)", () => {
		const result = evaluate(75.0, null, baseConfig);
		expect(result.kept).toBe(true);
		expect(result.delta).toBe(0);
		expect(result.confidence).toBeNull();
	});

	it("keeps improvement when direction is up", () => {
		const result = evaluate(80.0, 75.0, baseConfig);
		expect(result.kept).toBe(true);
		expect(result.delta).toBe(5);
	});

	it("discards regression when direction is up", () => {
		const result = evaluate(70.0, 75.0, baseConfig);
		expect(result.kept).toBe(false);
		expect(result.delta).toBe(-5);
	});

	it("keeps reduction when direction is down", () => {
		const downConfig = { ...baseConfig, direction: "down" as const };
		const result = evaluate(100, 150, downConfig);
		expect(result.kept).toBe(true);
		expect(result.delta).toBe(-50);
	});

	it("discards increase when direction is down", () => {
		const downConfig = { ...baseConfig, direction: "down" as const };
		const result = evaluate(200, 150, downConfig);
		expect(result.kept).toBe(false);
		expect(result.delta).toBe(50);
	});

	it("discards when improvement is below minDelta", () => {
		const config = { ...baseConfig, minDelta: 2.0 };
		const result = evaluate(75.5, 75.0, config);
		expect(result.kept).toBe(false);
		expect(result.reason).toContain("too small");
	});

	it("keeps when improvement meets minDelta", () => {
		const config = { ...baseConfig, minDelta: 2.0 };
		const result = evaluate(77.5, 75.0, config);
		expect(result.kept).toBe(true);
	});

	it("discards when value equals best (no change)", () => {
		const result = evaluate(75.0, 75.0, baseConfig);
		expect(result.kept).toBe(false);
	});

	it("returns null confidence when no history is provided", () => {
		const result = evaluate(80.0, 75.0, baseConfig);
		expect(result.confidence).toBeNull();
	});

	it("returns null confidence when history has fewer than 3 entries", () => {
		const history = [
			makeIteration({ value: 70 }),
			makeIteration({ value: 75 }),
		];
		const result = evaluate(80.0, 75.0, baseConfig, history);
		expect(result.confidence).toBeNull();
	});

	it("includes confidence when history has 3+ entries", () => {
		const history = [
			makeIteration({ value: 70 }),
			makeIteration({ value: 72 }),
			makeIteration({ value: 74 }),
			makeIteration({ value: 73 }),
			makeIteration({ value: 75 }),
		];
		const result = evaluate(80.0, 75.0, baseConfig, history);
		expect(result.confidence).not.toBeNull();
		expect(result.confidence!.sampleSize).toBe(5);
		expect(result.confidence!.level).toBeDefined();
		expect(result.confidence!.mad).toBeGreaterThan(0);
	});

	it("confidence is advisory only — does not change keep/discard decision", () => {
		// Even with low confidence, a genuine improvement is still kept
		const history = [
			makeIteration({ value: 10 }),
			makeIteration({ value: 50 }),
			makeIteration({ value: 90 }),
		];
		// MAD will be large (40), delta=1 gives low confidence
		const result = evaluate(76.0, 75.0, baseConfig, history);
		expect(result.kept).toBe(true);
		expect(result.confidence).not.toBeNull();
		expect(result.confidence!.level).toBe("low");
	});
});
