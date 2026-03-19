import { randomUUID } from "node:crypto";
import { appendJsonl, readJsonl } from "@ultracoder/core";

export interface Span {
	traceId: string;
	spanId: string;
	parentSpanId?: string;
	name: string;
	startTime: string;
	endTime?: string;
	durationMs?: number;
	attributes: Record<string, unknown>;
	status: "ok" | "error" | "in_progress";
}

/**
 * Create a new trace span.
 */
export function createSpan(
	name: string,
	opts?: { traceId?: string; parentSpanId?: string; attributes?: Record<string, unknown> },
): Span {
	return {
		traceId: opts?.traceId ?? randomUUID(),
		spanId: randomUUID().slice(0, 8),
		parentSpanId: opts?.parentSpanId,
		name,
		startTime: new Date().toISOString(),
		attributes: opts?.attributes ?? {},
		status: "in_progress",
	};
}

/**
 * End a span, computing duration.
 */
export function endSpan(span: Span, status: "ok" | "error" = "ok"): Span {
	const endTime = new Date().toISOString();
	return {
		...span,
		endTime,
		durationMs: new Date(endTime).getTime() - new Date(span.startTime).getTime(),
		status,
	};
}

/**
 * Write a span to an NDJSON trace file.
 */
export async function writeSpan(filePath: string, span: Span): Promise<void> {
	await appendJsonl(filePath, span);
}

/**
 * Read all spans from a trace file.
 */
export async function readSpans(filePath: string): Promise<Span[]> {
	return readJsonl<Span>(filePath);
}

/**
 * Aggregate metrics from spans.
 */
export interface SpanMetrics {
	totalSpans: number;
	errorCount: number;
	avgDurationMs: number;
	maxDurationMs: number;
	spansByName: Record<string, number>;
}

export function aggregateSpans(spans: Span[]): SpanMetrics {
	const completed = spans.filter((s) => s.durationMs !== undefined);
	const durations = completed.map((s) => s.durationMs!);
	const spansByName: Record<string, number> = {};

	for (const span of spans) {
		spansByName[span.name] = (spansByName[span.name] ?? 0) + 1;
	}

	return {
		totalSpans: spans.length,
		errorCount: spans.filter((s) => s.status === "error").length,
		avgDurationMs:
			durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
		maxDurationMs: durations.length > 0 ? Math.max(...durations) : 0,
		spansByName,
	};
}
