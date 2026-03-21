import { describe, expect, it } from "vitest";
import { generateExperimentPRBody } from "./context-writer.js";
import type { ExperimentState } from "./types.js";

describe("generateExperimentPRBody", () => {
	it("generates a markdown summary", () => {
		const state: ExperimentState = {
			enabled: true,
			objective: "Improve test coverage",
			metric: {
				name: "coverage",
				command: "pnpm test:coverage",
				extract: "$.total.lines.pct",
				direction: "up",
			},
			termination: { maxIterations: 10, maxNoImprovement: 3 },
			mode: "sequential",
			parallelVariations: 3,
			iteration: 5,
			bestValue: 82.3,
			bestCommit: "abc123",
			history: [
				{ iteration: 1, value: 75.1, delta: 0, kept: true, timestamp: "2026-01-01T00:00:00Z" },
				{ iteration: 2, value: 78.0, delta: 2.9, kept: true, timestamp: "2026-01-01T00:01:00Z" },
				{ iteration: 3, value: 76.0, delta: -2.0, kept: false, timestamp: "2026-01-01T00:02:00Z" },
				{ iteration: 4, value: 80.5, delta: 2.5, kept: true, timestamp: "2026-01-01T00:03:00Z" },
				{ iteration: 5, value: 82.3, delta: 1.8, kept: true, timestamp: "2026-01-01T00:04:00Z" },
			],
			status: "terminated",
			terminationReason: "Target reached",
		};

		const body = generateExperimentPRBody(state);
		expect(body).toContain("Improve test coverage");
		expect(body).toContain("coverage");
		expect(body).toContain("82.3");
		expect(body).toContain("Target reached");
		expect(body).toContain("| 1 |");
		expect(body).toContain("| 5 |");
	});

	it("includes secondary metrics in PR body when present", () => {
		const state: ExperimentState = {
			enabled: true,
			objective: "Reduce bundle size",
			metric: {
				name: "bundle-size",
				command: "echo 500",
				extract: "/\\d+/",
				direction: "down",
			},
			termination: { maxIterations: 10, maxNoImprovement: 3 },
			mode: "sequential",
			parallelVariations: 1,
			iteration: 2,
			bestValue: 450,
			bestCommit: "def456",
			history: [
				{
					iteration: 1, value: 500, delta: 0, kept: true,
					timestamp: "2026-01-01T00:00:00Z",
					secondaryValues: { "load-time": 3.2, "memory": 120 },
				},
				{
					iteration: 2, value: 450, delta: -50, kept: true,
					timestamp: "2026-01-01T00:01:00Z",
					secondaryValues: { "load-time": 2.8, "memory": 115 },
				},
			],
			status: "terminated",
			terminationReason: "Target reached",
			secondaryMetrics: [
				{ name: "load-time", command: "echo 2.8", extract: "/[\\d.]+/", direction: "down" },
				{ name: "memory", command: "echo 115", extract: "/\\d+/", direction: "down" },
			],
			secondaryBaselines: { "load-time": 3.2, "memory": 120 },
		};

		const body = generateExperimentPRBody(state);
		expect(body).toContain("### Secondary Metrics");
		expect(body).toContain("load-time");
		expect(body).toContain("memory");
		expect(body).toContain("2.8");
		expect(body).toContain("115");
		expect(body).toContain("3.2");
		expect(body).toContain("120");
	});
});
