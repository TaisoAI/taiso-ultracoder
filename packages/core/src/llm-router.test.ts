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

describe("WeightedRouter latency-adaptive routing", () => {
	it("recordLatency updates EMA correctly", () => {
		const ep: LLMEndpoint = { url: "https://a.example.com", weight: 1 };
		const router = new WeightedRouter([ep], { alpha: 0.3 });

		// First record: EMA should be set directly (since ema starts at 0)
		router.recordLatency(ep.url, 100);
		const h1 = router.getHealth(ep.url)!;
		expect(h1.latencyEma).toBe(100);
		expect(h1.requestCount).toBe(1);

		// Second record: EMA = 0.3 * 200 + 0.7 * 100 = 60 + 70 = 130
		router.recordLatency(ep.url, 200);
		const h2 = router.getHealth(ep.url)!;
		expect(h2.latencyEma).toBeCloseTo(130, 5);
		expect(h2.requestCount).toBe(2);

		// Third record: EMA = 0.3 * 50 + 0.7 * 130 = 15 + 91 = 106
		router.recordLatency(ep.url, 50);
		const h3 = router.getHealth(ep.url)!;
		expect(h3.latencyEma).toBeCloseTo(106, 5);
		expect(h3.requestCount).toBe(3);
	});

	it("faster endpoint gets higher adjusted weight (skewed distribution)", () => {
		const fast: LLMEndpoint = { url: "https://fast.example.com", weight: 1 };
		const slow: LLMEndpoint = { url: "https://slow.example.com", weight: 1 };
		const router = new WeightedRouter([fast, slow]);

		// Record latencies — fast is 50ms, slow is 200ms
		for (let i = 0; i < 5; i++) {
			router.recordLatency(fast.url, 50);
			router.recordLatency(slow.url, 200);
		}

		const counts = { fast: 0, slow: 0 };
		for (let i = 0; i < 1000; i++) {
			const selected = router.select();
			if (selected === fast) counts.fast++;
			else counts.slow++;
		}

		// Fast endpoint should be selected significantly more often
		expect(counts.fast).toBeGreaterThan(counts.slow);
		// With avgEma=125, fast factor=clamp(125/50,0.5,2)=2.0, slow factor=clamp(125/200,0.5,2)=0.625
		// Ratio should be roughly 2.0/0.625 = 3.2:1, so fast ~ 76%
		expect(counts.fast).toBeGreaterThan(650);
	});

	it("after 3 consecutive recordFailure, endpoint is marked unhealthy", () => {
		const ep: LLMEndpoint = { url: "https://a.example.com", weight: 1 };
		const router = new WeightedRouter([ep]);

		router.recordFailure(ep.url);
		expect(router.getHealth(ep.url)!.healthy).toBe(true);
		expect(router.getHealth(ep.url)!.consecutiveFailures).toBe(1);

		router.recordFailure(ep.url);
		expect(router.getHealth(ep.url)!.healthy).toBe(true);
		expect(router.getHealth(ep.url)!.consecutiveFailures).toBe(2);

		router.recordFailure(ep.url);
		expect(router.getHealth(ep.url)!.healthy).toBe(false);
		expect(router.getHealth(ep.url)!.consecutiveFailures).toBe(3);
		expect(router.getHealth(ep.url)!.lastFailureAt).toBeDefined();
	});

	it("unhealthy endpoint is skipped in select()", () => {
		const healthy: LLMEndpoint = { url: "https://healthy.example.com", weight: 1 };
		const broken: LLMEndpoint = { url: "https://broken.example.com", weight: 1 };
		const router = new WeightedRouter([healthy, broken]);

		// Record some latency so health map is populated for both
		router.recordLatency(healthy.url, 100);
		router.recordLatency(broken.url, 100);

		// Mark broken as unhealthy
		router.recordFailure(broken.url);
		router.recordFailure(broken.url);
		router.recordFailure(broken.url);

		// Set lastProbeAt to now so it's not due for probe
		const brokenHealth = router.getHealth(broken.url)!;
		brokenHealth.lastProbeAt = Date.now();

		// All selections should go to healthy endpoint
		for (let i = 0; i < 50; i++) {
			expect(router.select()).toBe(healthy);
		}
	});

	it("after probe interval, unhealthy endpoint gets one probe chance", () => {
		const healthy: LLMEndpoint = { url: "https://healthy.example.com", weight: 1 };
		const broken: LLMEndpoint = { url: "https://broken.example.com", weight: 1 };
		const router = new WeightedRouter([healthy, broken], { probeIntervalMs: 30_000 });

		router.recordLatency(healthy.url, 100);
		router.recordLatency(broken.url, 100);

		// Mark broken as unhealthy
		router.recordFailure(broken.url);
		router.recordFailure(broken.url);
		router.recordFailure(broken.url);

		// Set lastProbeAt to 31 seconds ago so it's due for a probe
		const brokenHealth = router.getHealth(broken.url)!;
		brokenHealth.lastProbeAt = Date.now() - 31_000;

		// Run many selections — broken should occasionally be selected (weight * 0.1)
		// healthy adjusted weight: avgEma=100, factor=clamp(100/100)=1, w=1
		// broken probe weight: 1 * 0.1 = 0.1
		// But after the first select call, lastProbeAt is updated, so subsequent calls skip it
		const firstSelect = router.select();
		// After first call, lastProbeAt is updated to now, so all further calls skip broken
		// The first call has a 0.1/(1+0.1) ≈ 9% chance of selecting broken

		// Verify that lastProbeAt was updated (probe was attempted)
		expect(brokenHealth.lastProbeAt).toBeGreaterThan(Date.now() - 1000);

		// Now further calls should always return healthy (probe window closed)
		let brokenCount = 0;
		for (let i = 0; i < 100; i++) {
			if (router.select() === broken) brokenCount++;
		}
		expect(brokenCount).toBe(0);
	});

	it("recordSuccess after failures resets health to healthy", () => {
		const ep: LLMEndpoint = { url: "https://a.example.com", weight: 1 };
		const router = new WeightedRouter([ep]);

		// Cause unhealthy state
		router.recordFailure(ep.url);
		router.recordFailure(ep.url);
		router.recordFailure(ep.url);
		expect(router.getHealth(ep.url)!.healthy).toBe(false);

		// Record success to recover
		router.recordSuccess(ep.url);
		const h = router.getHealth(ep.url)!;
		expect(h.healthy).toBe(true);
		expect(h.consecutiveFailures).toBe(0);
	});

	it("backward compatible: router without health tracking works identically", () => {
		const a: LLMEndpoint = { url: "https://a.example.com", weight: 1 };
		const b: LLMEndpoint = { url: "https://b.example.com", weight: 1 };
		const router = new WeightedRouter([a, b]);

		// No recordLatency/recordFailure calls — should use static weights
		const counts = { a: 0, b: 0 };
		for (let i = 0; i < 1000; i++) {
			const selected = router.select();
			if (selected === a) counts.a++;
			else counts.b++;
		}

		// With equal weights and no health data, expect roughly 50/50
		expect(counts.a).toBeGreaterThan(400);
		expect(counts.b).toBeGreaterThan(400);

		// getAllHealth should be empty
		expect(router.getAllHealth().size).toBe(0);
	});

	it("getAllHealth returns a copy of all health data", () => {
		const a: LLMEndpoint = { url: "https://a.example.com", weight: 1 };
		const b: LLMEndpoint = { url: "https://b.example.com", weight: 1 };
		const router = new WeightedRouter([a, b]);

		router.recordLatency(a.url, 50);
		router.recordLatency(b.url, 150);

		const allHealth = router.getAllHealth();
		expect(allHealth.size).toBe(2);
		expect(allHealth.get(a.url)!.latencyEma).toBe(50);
		expect(allHealth.get(b.url)!.latencyEma).toBe(150);

		// Verify it's a copy (modifying it doesn't affect internal state)
		allHealth.delete(a.url);
		expect(router.getAllHealth().size).toBe(2);
	});
});
