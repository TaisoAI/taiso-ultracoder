import { describe, expect, it, vi } from "vitest";
import { extractValue, runSecondaryMetrics } from "./metric-runner.js";
import type { SecondaryMetricConfig } from "./types.js";

describe("extractValue", () => {
	describe("JSONPath extraction", () => {
		it("extracts a top-level field", () => {
			const output = JSON.stringify({ coverage: 82.3 });
			expect(extractValue(output, "$.coverage")).toBe(82.3);
		});

		it("extracts a nested field", () => {
			const output = JSON.stringify({ total: { lines: { pct: 75.1 } } });
			expect(extractValue(output, "$.total.lines.pct")).toBe(75.1);
		});

		it("converts string numbers", () => {
			const output = JSON.stringify({ value: "42" });
			expect(extractValue(output, "$.value")).toBe(42);
		});

		it("throws on non-numeric value", () => {
			const output = JSON.stringify({ value: "hello" });
			expect(() => extractValue(output, "$.value")).toThrow("non-numeric");
		});

		it("throws on missing path segment", () => {
			const output = JSON.stringify({ a: { b: 1 } });
			expect(() => extractValue(output, "$.a.c.d")).toThrow();
		});

		it("throws on invalid JSON", () => {
			expect(() => extractValue("not json", "$.foo")).toThrow();
		});
	});

	describe("Regex extraction", () => {
		it("extracts with a capture group", () => {
			const output = "total size: 12345 bytes";
			expect(extractValue(output, "/size:\\s+(\\d+)/")).toBe(12345);
		});

		it("uses full match when no capture group", () => {
			const output = "value is 99.5 ok";
			expect(extractValue(output, "/\\d+\\.\\d+/")).toBe(99.5);
		});

		it("throws when regex does not match", () => {
			expect(() => extractValue("abc", "/\\d+/")).toThrow("did not match");
		});

		it("extracts when regex matches", () => {
			expect(extractValue("count is 42", "/\\d+/")).toBe(42);
		});

		it("throws when matched value is not a number", () => {
			const output = "name: hello";
			expect(() => extractValue(output, "/name:\\s+(\\w+)/")).toThrow("not a number");
		});
	});

	describe("invalid patterns", () => {
		it("throws on unsupported pattern format", () => {
			expect(() => extractValue("{}", "foo.bar")).toThrow("Invalid extract pattern");
		});
	});
});

describe("runSecondaryMetrics", () => {
	it("runs multiple metrics and returns results", async () => {
		const configs: SecondaryMetricConfig[] = [
			{
				name: "line-count",
				command: "echo '42'",
				extract: "/\\d+/",
			},
			{
				name: "file-size",
				command: `echo '${JSON.stringify({ size: 1024 })}'`,
				extract: "$.size",
			},
		];

		const results = await runSecondaryMetrics(configs, process.cwd());
		expect(results["line-count"]).toBe(42);
		expect(results["file-size"]).toBe(1024);
	});

	it("skips a failing metric without blocking others", async () => {
		const warn = vi.fn();
		const configs: SecondaryMetricConfig[] = [
			{
				name: "good-metric",
				command: "echo '100'",
				extract: "/\\d+/",
			},
			{
				name: "bad-metric",
				command: "echo 'no numbers here'",
				extract: "/\\d+/",
			},
			{
				name: "another-good",
				command: "echo '200'",
				extract: "/\\d+/",
			},
		];

		const results = await runSecondaryMetrics(configs, process.cwd(), warn);
		expect(results["good-metric"]).toBe(100);
		expect(results["another-good"]).toBe(200);
		expect(results["bad-metric"]).toBeUndefined();
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn).toHaveBeenCalledWith("bad-metric", expect.any(Error));
	});

	it("handles command failure gracefully", async () => {
		const warn = vi.fn();
		const configs: SecondaryMetricConfig[] = [
			{
				name: "failing-cmd",
				command: "exit 1",
				extract: "/\\d+/",
			},
			{
				name: "ok-metric",
				command: "echo '55'",
				extract: "/\\d+/",
			},
		];

		const results = await runSecondaryMetrics(configs, process.cwd(), warn);
		expect(results["ok-metric"]).toBe(55);
		expect(results["failing-cmd"]).toBeUndefined();
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn).toHaveBeenCalledWith("failing-cmd", expect.any(Error));
	});

	it("returns empty record for empty configs", async () => {
		const results = await runSecondaryMetrics([], process.cwd());
		expect(results).toEqual({});
	});
});
