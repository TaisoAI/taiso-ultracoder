import { describe, expect, it } from "vitest";
import { computeMAD, computeConfidence } from "./confidence.js";
import type { ExperimentIteration } from "./types.js";

function makeIteration(overrides: Partial<ExperimentIteration> & { value: number }): ExperimentIteration {
	return {
		iteration: 1,
		delta: 0,
		kept: false,
		timestamp: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

describe("computeMAD", () => {
	it("computes MAD for [1, 2, 3, 4, 5]", () => {
		// median = 3, deviations = [2, 1, 0, 1, 2], median of deviations = 1
		expect(computeMAD([1, 2, 3, 4, 5])).toBe(1);
	});

	it("returns 0 for identical values", () => {
		expect(computeMAD([7, 7, 7, 7])).toBe(0);
	});

	it("returns 0 for empty array", () => {
		expect(computeMAD([])).toBe(0);
	});

	it("returns 0 for single value", () => {
		expect(computeMAD([42])).toBe(0);
	});

	it("computes MAD for even-length array", () => {
		// [1, 2, 3, 4] -> median = 2.5, deviations = [1.5, 0.5, 0.5, 1.5], sorted = [0.5, 0.5, 1.5, 1.5], median = 1.0
		expect(computeMAD([1, 2, 3, 4])).toBe(1);
	});

	it("handles unsorted input", () => {
		expect(computeMAD([5, 1, 3, 2, 4])).toBe(1);
	});
});

describe("computeConfidence", () => {
	it("returns null with fewer than 3 data points", () => {
		const history = [
			makeIteration({ value: 10 }),
			makeIteration({ value: 12 }),
		];
		expect(computeConfidence(history, 2)).toBeNull();
	});

	it("returns null with 0 data points", () => {
		expect(computeConfidence([], 5)).toBeNull();
	});

	it("returns high confidence when delta is large relative to noise", () => {
		// values: [10, 10.5, 11, 10.5, 10] -> median=10.5, devs=[0.5,0,0.5,0,0.5], sorted=[0,0,0.5,0.5,0.5], MAD=0.5
		const history = [
			makeIteration({ value: 10 }),
			makeIteration({ value: 10.5 }),
			makeIteration({ value: 11 }),
			makeIteration({ value: 10.5 }),
			makeIteration({ value: 10 }),
		];
		const bestDelta = 5; // large delta relative to MAD=0.5 -> score=10
		const result = computeConfidence(history, bestDelta);
		expect(result).not.toBeNull();
		expect(result!.level).toBe("high");
		expect(result!.score).toBeGreaterThanOrEqual(2.0);
		expect(result!.mad).toBe(0.5);
		expect(result!.sampleSize).toBe(5);
	});

	it("returns low confidence when delta is within noise", () => {
		// values: [10, 12, 14, 16, 18] -> median=14, devs=[4,2,0,2,4], sorted=[0,2,2,4,4], MAD=2
		const history = [
			makeIteration({ value: 10 }),
			makeIteration({ value: 12 }),
			makeIteration({ value: 14 }),
			makeIteration({ value: 16 }),
			makeIteration({ value: 18 }),
		];
		const bestDelta = 1; // small delta relative to MAD=2 -> score=0.5
		const result = computeConfidence(history, bestDelta);
		expect(result).not.toBeNull();
		expect(result!.level).toBe("low");
		expect(result!.score).toBeLessThan(1.0);
		expect(result!.mad).toBe(2);
	});

	it("returns medium confidence for borderline cases", () => {
		// values: [10, 12, 14, 16, 18] -> MAD=2
		const history = [
			makeIteration({ value: 10 }),
			makeIteration({ value: 12 }),
			makeIteration({ value: 14 }),
			makeIteration({ value: 16 }),
			makeIteration({ value: 18 }),
		];
		const bestDelta = 3; // score = 3/2 = 1.5 -> medium
		const result = computeConfidence(history, bestDelta);
		expect(result).not.toBeNull();
		expect(result!.level).toBe("medium");
		expect(result!.score).toBeGreaterThanOrEqual(1.0);
		expect(result!.score).toBeLessThan(2.0);
	});

	it("handles zero MAD with nonzero delta (all identical values)", () => {
		const history = [
			makeIteration({ value: 5 }),
			makeIteration({ value: 5 }),
			makeIteration({ value: 5 }),
		];
		const result = computeConfidence(history, 2);
		expect(result).not.toBeNull();
		expect(result!.score).toBe(Infinity);
		expect(result!.level).toBe("high");
		expect(result!.mad).toBe(0);
	});

	it("handles zero MAD with zero delta", () => {
		const history = [
			makeIteration({ value: 5 }),
			makeIteration({ value: 5 }),
			makeIteration({ value: 5 }),
		];
		const result = computeConfidence(history, 0);
		expect(result).not.toBeNull();
		expect(result!.score).toBe(0);
		expect(result!.level).toBe("low");
	});

	it("uses all history values regardless of kept status", () => {
		const history = [
			makeIteration({ value: 10, kept: true }),
			makeIteration({ value: 12, kept: false }),
			makeIteration({ value: 14, kept: false }),
			makeIteration({ value: 16, kept: true }),
			makeIteration({ value: 18, kept: false }),
		];
		// All 5 values should be used -> MAD=2
		const result = computeConfidence(history, 1);
		expect(result).not.toBeNull();
		expect(result!.sampleSize).toBe(5);
		expect(result!.mad).toBe(2);
	});

	it("works with exactly 3 data points", () => {
		// [10, 20, 30] -> median=20, devs=[10,0,10], sorted=[0,10,10], MAD=10
		const history = [
			makeIteration({ value: 10 }),
			makeIteration({ value: 20 }),
			makeIteration({ value: 30 }),
		];
		const result = computeConfidence(history, 25); // score = 25/10 = 2.5
		expect(result).not.toBeNull();
		expect(result!.level).toBe("high");
		expect(result!.sampleSize).toBe(3);
	});
});
