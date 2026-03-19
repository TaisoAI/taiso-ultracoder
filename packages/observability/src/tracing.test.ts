import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { aggregateSpans, createSpan, endSpan, readSpans, writeSpan } from "./tracing.js";

describe("tracing", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "uc-trace-"));
	});

	afterEach(async () => {
		await fs.promises.rm(tmpDir, { recursive: true, force: true });
	});

	it("creates a span with defaults", () => {
		const span = createSpan("test-op");
		expect(span.name).toBe("test-op");
		expect(span.status).toBe("in_progress");
		expect(span.traceId).toBeTruthy();
		expect(span.spanId).toBeTruthy();
	});

	it("ends a span with duration", () => {
		const span = createSpan("test-op");
		const ended = endSpan(span, "ok");
		expect(ended.status).toBe("ok");
		expect(ended.durationMs).toBeGreaterThanOrEqual(0);
		expect(ended.endTime).toBeTruthy();
	});

	it("writes and reads spans", async () => {
		const file = path.join(tmpDir, "trace.jsonl");
		const span1 = endSpan(createSpan("op1"));
		const span2 = endSpan(createSpan("op2"), "error");
		await writeSpan(file, span1);
		await writeSpan(file, span2);

		const spans = await readSpans(file);
		expect(spans).toHaveLength(2);
		expect(spans[0].name).toBe("op1");
		expect(spans[1].status).toBe("error");
	});

	it("aggregates span metrics", () => {
		const spans = [
			{ ...endSpan(createSpan("a")), durationMs: 100 },
			{ ...endSpan(createSpan("a")), durationMs: 200 },
			{ ...endSpan(createSpan("b"), "error"), durationMs: 50 },
		];
		const metrics = aggregateSpans(spans);
		expect(metrics.totalSpans).toBe(3);
		expect(metrics.errorCount).toBe(1);
		expect(metrics.avgDurationMs).toBeCloseTo(116.67, 0);
		expect(metrics.maxDurationMs).toBe(200);
		expect(metrics.spansByName.a).toBe(2);
		expect(metrics.spansByName.b).toBe(1);
	});
});
