import { describe, expect, it } from "vitest";
import { checkTermination } from "./termination.js";
import type { ExperimentState } from "./types.js";

function makeState(overrides: Partial<ExperimentState> = {}): ExperimentState {
	return {
		enabled: true,
		objective: "test",
		metric: {
			name: "coverage",
			command: "test",
			extract: "$.coverage",
			direction: "up",
		},
		termination: {
			maxIterations: 10,
			maxNoImprovement: 3,
		},
		mode: "sequential",
		parallelVariations: 3,
		iteration: 0,
		bestValue: null,
		bestCommit: null,
		history: [],
		status: "running",
		...overrides,
	};
}

describe("checkTermination", () => {
	it("does not terminate at the start", () => {
		const result = checkTermination(makeState());
		expect(result.terminated).toBe(false);
	});

	it("terminates when max iterations reached", () => {
		const state = makeState({ iteration: 10 });
		const result = checkTermination(state);
		expect(result.terminated).toBe(true);
		expect(result.reason).toContain("Max iterations");
	});

	it("terminates when target reached (direction up)", () => {
		const state = makeState({
			iteration: 5,
			bestValue: 95,
			metric: {
				name: "coverage",
				command: "test",
				extract: "$.coverage",
				direction: "up",
				target: 90,
			},
		});
		const result = checkTermination(state);
		expect(result.terminated).toBe(true);
		expect(result.reason).toContain("Target reached");
	});

	it("terminates when target reached (direction down)", () => {
		const state = makeState({
			iteration: 5,
			bestValue: 80,
			metric: {
				name: "bundle",
				command: "test",
				extract: "$.size",
				direction: "down",
				target: 100,
			},
		});
		const result = checkTermination(state);
		expect(result.terminated).toBe(true);
	});

	it("does not terminate when target not yet reached", () => {
		const state = makeState({
			iteration: 5,
			bestValue: 85,
			metric: {
				name: "coverage",
				command: "test",
				extract: "$.coverage",
				direction: "up",
				target: 90,
			},
		});
		const result = checkTermination(state);
		expect(result.terminated).toBe(false);
	});

	it("terminates on no-improvement streak", () => {
		const state = makeState({
			iteration: 6,
			bestValue: 80,
			history: [
				{ iteration: 4, value: 79, delta: -1, kept: false, timestamp: "" },
				{ iteration: 5, value: 78, delta: -2, kept: false, timestamp: "" },
				{ iteration: 6, value: 77, delta: -3, kept: false, timestamp: "" },
			],
		});
		const result = checkTermination(state);
		expect(result.terminated).toBe(true);
		expect(result.reason).toContain("No improvement");
	});

	it("does not terminate on mixed improvement streak", () => {
		const state = makeState({
			iteration: 6,
			bestValue: 80,
			history: [
				{ iteration: 4, value: 79, delta: -1, kept: false, timestamp: "" },
				{ iteration: 5, value: 82, delta: 2, kept: true, timestamp: "" },
				{ iteration: 6, value: 77, delta: -3, kept: false, timestamp: "" },
			],
		});
		const result = checkTermination(state);
		expect(result.terminated).toBe(false);
	});

	it("terminates when budget exceeded", () => {
		const state = makeState({
			iteration: 5,
			termination: { maxIterations: 20, maxNoImprovement: 5, maxCostUsd: 10 },
		});
		const result = checkTermination(state, 12.5);
		expect(result.terminated).toBe(true);
		expect(result.reason).toContain("Budget exceeded");
	});

	it("does not terminate when within budget", () => {
		const state = makeState({
			iteration: 5,
			termination: { maxIterations: 20, maxNoImprovement: 5, maxCostUsd: 10 },
		});
		const result = checkTermination(state, 8.0);
		expect(result.terminated).toBe(false);
	});
});
