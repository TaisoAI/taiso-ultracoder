import { describe, expect, it, vi } from "vitest";
import { WeightedRouter } from "./llm-router.js";
import type { LLMEndpoint } from "./llm-router.js";

describe("WeightedRouter", () => {
	it("returns undefined for empty endpoints", () => {
		const router = new WeightedRouter([]);
		expect(router.select()).toBeUndefined();
	});

	it("returns the only endpoint when there is one", () => {
		const endpoint: LLMEndpoint = { url: "https://api.example.com", weight: 1 };
		const router = new WeightedRouter([endpoint]);
		expect(router.select()).toBe(endpoint);
	});

	it("selects endpoints respecting weights", () => {
		const heavy: LLMEndpoint = { url: "https://heavy.example.com", weight: 100 };
		const light: LLMEndpoint = { url: "https://light.example.com", weight: 0.001 };
		const router = new WeightedRouter([heavy, light]);

		// With weight 100 vs 0.001, heavy should be selected almost every time
		const counts = { heavy: 0, light: 0 };
		for (let i = 0; i < 100; i++) {
			const selected = router.select();
			if (selected === heavy) counts.heavy++;
			else counts.light++;
		}
		expect(counts.heavy).toBeGreaterThan(90);
	});

	it("filters endpoints by model", () => {
		const gptEndpoint: LLMEndpoint = {
			url: "https://openai.example.com",
			weight: 1,
			models: ["gpt-4o"],
		};
		const claudeEndpoint: LLMEndpoint = {
			url: "https://anthropic.example.com",
			weight: 1,
			models: ["claude-sonnet-4-5-20250514"],
		};
		const router = new WeightedRouter([gptEndpoint, claudeEndpoint]);

		// When requesting a specific model, only matching endpoints should be candidates
		for (let i = 0; i < 20; i++) {
			expect(router.select("gpt-4o")).toBe(gptEndpoint);
			expect(router.select("claude-sonnet-4-5-20250514")).toBe(claudeEndpoint);
		}
	});

	it("includes endpoints without models restriction when filtering by model", () => {
		const restricted: LLMEndpoint = {
			url: "https://restricted.example.com",
			weight: 1,
			models: ["gpt-4o"],
		};
		const unrestricted: LLMEndpoint = {
			url: "https://any.example.com",
			weight: 1,
		};
		const router = new WeightedRouter([restricted, unrestricted]);

		// For "claude-sonnet-4-5-20250514", only unrestricted should match
		for (let i = 0; i < 20; i++) {
			expect(router.select("claude-sonnet-4-5-20250514")).toBe(unrestricted);
		}
	});

	it("falls back to all endpoints when no model filter matches", () => {
		const endpoint: LLMEndpoint = {
			url: "https://api.example.com",
			weight: 1,
			models: ["gpt-4o"],
		};
		const router = new WeightedRouter([endpoint]);

		// No endpoint supports "unknown-model", but since modelFiltered is empty,
		// it falls back to all candidates
		expect(router.select("unknown-model")).toBe(endpoint);
	});
});
