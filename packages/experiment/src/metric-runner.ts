import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { MetricConfig, MeasurementResult, SecondaryMetricConfig } from "./types.js";

const execFile = promisify(execFileCb);

/**
 * Execute the measurement command and extract the metric value.
 */
export async function measureMetric(
	config: MetricConfig,
	cwd: string,
): Promise<MeasurementResult> {
	const { stdout } = await execFile("sh", ["-c", config.command], {
		cwd,
		maxBuffer: 10 * 1024 * 1024,
		timeout: 120_000,
	});

	const value = extractValue(stdout, config.extract);
	return { value, raw: stdout };
}

/**
 * Extract a numeric value from command output using either JSONPath or regex.
 *
 * JSONPath format: $.path.to.field
 * Regex format: /pattern with (capture group)/
 */
export function extractValue(output: string, extract: string): number {
	if (extract.startsWith("$")) {
		return extractJsonPath(output, extract);
	}

	if (extract.startsWith("/") && extract.endsWith("/")) {
		return extractRegex(output, extract);
	}

	throw new Error(
		`Invalid extract pattern: "${extract}". Must start with "$" (JSONPath) or be wrapped in "/" (regex).`,
	);
}

/**
 * Simple JSONPath extraction for dotted paths like $.total.lines.pct
 */
function extractJsonPath(output: string, path: string): number {
	const parsed = JSON.parse(output);
	// Strip leading "$." and split on "."
	const segments = path.replace(/^\$\.?/, "").split(".");
	let current: unknown = parsed;

	for (const segment of segments) {
		if (current === null || current === undefined) {
			throw new Error(`JSONPath "${path}" resolved to null at segment "${segment}"`);
		}
		if (typeof current !== "object") {
			throw new Error(`JSONPath "${path}" hit non-object at segment "${segment}"`);
		}
		current = (current as Record<string, unknown>)[segment];
	}

	if (typeof current !== "number") {
		const num = Number(current);
		if (Number.isNaN(num)) {
			throw new Error(`JSONPath "${path}" resolved to non-numeric value: ${String(current)}`);
		}
		return num;
	}

	return current;
}

/**
 * Regex extraction using the first capture group.
 */
function extractRegex(output: string, pattern: string): number {
	// Strip surrounding slashes
	const inner = pattern.slice(1, -1);
	const regex = new RegExp(inner);
	const match = regex.exec(output);

	if (!match) {
		throw new Error(`Regex ${pattern} did not match output`);
	}

	// Use first capture group if available, otherwise full match
	const raw = match[1] ?? match[0];
	const value = Number(raw);

	if (Number.isNaN(value)) {
		throw new Error(`Regex ${pattern} matched "${raw}" which is not a number`);
	}

	return value;
}

/**
 * Run all secondary metric commands and extract values.
 * Individual metric failures are warned but do not fail the overall measurement.
 *
 * @returns A record mapping metric name to its measured value.
 *          Metrics that fail measurement are omitted from the result.
 */
export async function runSecondaryMetrics(
	configs: SecondaryMetricConfig[],
	cwd: string,
	warn?: (metricName: string, error: Error) => void,
): Promise<Record<string, number>> {
	const results: Record<string, number> = {};

	for (const config of configs) {
		try {
			const { stdout } = await execFile("sh", ["-c", config.command], {
				cwd,
				maxBuffer: 10 * 1024 * 1024,
				timeout: 120_000,
			});
			results[config.name] = extractValue(stdout, config.extract);
		} catch (err) {
			warn?.(config.name, err instanceof Error ? err : new Error(String(err)));
		}
	}

	return results;
}
