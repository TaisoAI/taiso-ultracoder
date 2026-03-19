import type { AgentActivity } from "@ultracoder/core";

export type AgentIntent =
	| "exploring"
	| "planning"
	| "implementing"
	| "testing"
	| "debugging"
	| "reviewing"
	| "committing"
	| "idle";

export interface IntentClassification {
	intent: AgentIntent;
	confidence: number; // 0-1
	evidence: string; // brief explanation
}

const EXPLORE_TOOLS = /\b(Read|Grep|Glob)\b/;
const TEST_COMMANDS = /\b(test|pytest|vitest|jest|mocha)\b/;
const GIT_COMMANDS = /\b(git\s+(commit|add|push))\b/;
const WRITE_TOOLS = /\b(Write|Edit)\b/;

/**
 * Classify agent intent based on recent tool usage patterns.
 * Pure heuristic — no LLM needed.
 */
export function classifyIntent(
	recentEvents: AgentActivity[],
	windowSize = 10,
): IntentClassification {
	const events = recentEvents.slice(-windowSize);

	// No events or all idle
	if (events.length === 0) {
		return { intent: "idle", confidence: 1.0, evidence: "no events" };
	}

	const allIdle = events.every((e) => e.type === "idle");
	if (allIdle) {
		return { intent: "idle", confidence: 1.0, evidence: "all events are idle" };
	}

	const total = events.length;

	// Count explore tool calls
	const exploreCount = events.filter(
		(e) => e.type === "tool_call" && e.detail && EXPLORE_TOOLS.test(e.detail),
	).length;
	if (exploreCount > total / 2) {
		return {
			intent: "exploring",
			confidence: exploreCount / total,
			evidence: `${exploreCount}/${total} events are Read/Grep/Glob tool calls`,
		};
	}

	// Check for testing (Bash with test commands)
	const testingEvents = events.filter(
		(e) =>
			e.type === "tool_call" &&
			e.detail &&
			/\bBash\b/.test(e.detail) &&
			TEST_COMMANDS.test(e.detail),
	);
	if (testingEvents.length > 0) {
		return {
			intent: "testing",
			confidence: testingEvents.length / total,
			evidence: `${testingEvents.length}/${total} events are test-related Bash calls`,
		};
	}

	// Check for committing (Bash with git commands)
	const commitEvents = events.filter(
		(e) =>
			e.type === "tool_call" &&
			e.detail &&
			/\bBash\b/.test(e.detail) &&
			GIT_COMMANDS.test(e.detail),
	);
	if (commitEvents.length > 0) {
		return {
			intent: "committing",
			confidence: commitEvents.length / total,
			evidence: `${commitEvents.length}/${total} events are git commit/add/push calls`,
		};
	}

	// Check for debugging: error followed by Read
	for (let i = 0; i < events.length - 1; i++) {
		if (
			events[i].type === "error" &&
			events[i + 1].type === "tool_call" &&
			events[i + 1].detail &&
			/\bRead\b/.test(events[i + 1].detail!)
		) {
			const debugPairs = countDebugPairs(events);
			return {
				intent: "debugging",
				confidence: Math.min((debugPairs * 2) / total, 1),
				evidence: `found ${debugPairs} error→Read sequence(s)`,
			};
		}
	}

	// Check for implementing (majority Write/Edit)
	const writeCount = events.filter(
		(e) => e.type === "tool_call" && e.detail && WRITE_TOOLS.test(e.detail),
	).length;
	if (writeCount > total / 2) {
		return {
			intent: "implementing",
			confidence: writeCount / total,
			evidence: `${writeCount}/${total} events are Write/Edit tool calls`,
		};
	}

	// Default fallback
	return {
		intent: "planning",
		confidence: 0.5,
		evidence: "no dominant pattern detected, defaulting to planning",
	};
}

function countDebugPairs(events: AgentActivity[]): number {
	let count = 0;
	for (let i = 0; i < events.length - 1; i++) {
		if (
			events[i].type === "error" &&
			events[i + 1].type === "tool_call" &&
			events[i + 1].detail &&
			/\bRead\b/.test(events[i + 1].detail!)
		) {
			count++;
		}
	}
	return count;
}
