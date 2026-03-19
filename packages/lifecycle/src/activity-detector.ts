import type { AgentActivity, AgentActivityType } from "@ultracoder/core";
import { readJsonl } from "@ultracoder/core";
import { type IntentClassification, classifyIntent } from "./intent-classifier.js";

export interface ActivitySummary {
	lastActivity: AgentActivity | null;
	idleSince: string | null;
	isActive: boolean;
	isCompleted: boolean;
	totalEvents: number;
	intent?: IntentClassification;
}

/**
 * Detect agent activity by parsing JSONL activity logs.
 */
export async function detectActivity(logPath: string): Promise<ActivitySummary> {
	const events = await readJsonl<AgentActivity>(logPath);

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
