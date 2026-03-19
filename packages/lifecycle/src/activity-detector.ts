import * as fs from "node:fs";
import type { AgentActivity, AgentActivityType } from "@ultracoder/core";
import { type IntentClassification, classifyIntent } from "./intent-classifier.js";

export interface ActivitySummary {
	lastActivity: AgentActivity | null;
	idleSince: string | null;
	isActive: boolean;
	isCompleted: boolean;
	totalEvents: number;
	intent?: IntentClassification;
}

const DEFAULT_MAX_BYTES = 128 * 1024; // 128KB

/**
 * Read the last `maxBytes` of a file, skipping the first partial line.
 */
export async function readLastBytes(filePath: string, maxBytes: number): Promise<string> {
	const stat = await fs.promises.stat(filePath);
	if (stat.size <= maxBytes) {
		return fs.promises.readFile(filePath, "utf-8");
	}
	const fd = await fs.promises.open(filePath, "r");
	try {
		const buffer = Buffer.alloc(maxBytes);
		await fd.read(buffer, 0, maxBytes, stat.size - maxBytes);
		// Skip the first partial line
		const content = buffer.toString("utf-8");
		const firstNewline = content.indexOf("\n");
		return firstNewline >= 0 ? content.slice(firstNewline + 1) : content;
	} finally {
		await fd.close();
	}
}

/**
 * Parse a string of JSONL content into typed records.
 * Skips blank lines and lines that fail to parse.
 */
export function parseJsonlString<T>(content: string): T[] {
	const results: T[] = [];
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.length === 0) continue;
		try {
			results.push(JSON.parse(trimmed) as T);
		} catch {
			// skip malformed lines (e.g. partial line at boundary)
		}
	}
	return results;
}

/**
 * Detect agent activity by parsing JSONL activity logs.
 * Only reads the last 128KB to avoid memory issues on long-running sessions.
 */
export async function detectActivity(
	logPath: string,
	maxBytes: number = DEFAULT_MAX_BYTES,
): Promise<ActivitySummary> {
	let content: string;
	try {
		content = await readLastBytes(logPath, maxBytes);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") {
			return {
				lastActivity: null,
				idleSince: null,
				isActive: false,
				isCompleted: false,
				totalEvents: 0,
			};
		}
		throw err;
	}

	const events = parseJsonlString<AgentActivity>(content);

	if (events.length === 0) {
		return {
			lastActivity: null,
			idleSince: null,
			isActive: false,
			isCompleted: false,
			totalEvents: 0,
		};
	}

	const last = events[events.length - 1];

	return {
		lastActivity: last,
		idleSince: last.type === "idle" ? last.timestamp : null,
		isActive: last.type === "active" || last.type === "tool_call",
		isCompleted: last.type === "completed",
		totalEvents: events.length,
		intent: classifyIntent(events),
	};
}

/**
 * Check if an agent appears stuck (idle for too long).
 */
export function isStuck(summary: ActivitySummary, maxIdleMs: number): boolean {
	if (!summary.idleSince) return false;
	const idleTime = Date.now() - new Date(summary.idleSince).getTime();
	return idleTime > maxIdleMs;
}
