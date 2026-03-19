import type { AgentActivity } from "@ultracoder/core";
import { describe, expect, it } from "vitest";
import { classifyIntent } from "./intent-classifier.js";

function makeEvent(
	type: AgentActivity["type"],
	detail?: string,
	timestamp?: string,
): AgentActivity {
	return { type, detail, timestamp: timestamp ?? new Date().toISOString() };
}

describe("classifyIntent", () => {
	it("returns idle with confidence 1.0 for empty events", () => {
		const result = classifyIntent([]);
		expect(result.intent).toBe("idle");
		expect(result.confidence).toBe(1.0);
	});

	it("returns idle when all events are idle", () => {
		const events = [makeEvent("idle"), makeEvent("idle"), makeEvent("idle")];
		const result = classifyIntent(events);
		expect(result.intent).toBe("idle");
		expect(result.confidence).toBe(1.0);
	});

	it("classifies exploring when majority are Read/Grep/Glob", () => {
		const events = [
			makeEvent("tool_call", "Read file.ts"),
			makeEvent("tool_call", "Grep pattern"),
			makeEvent("tool_call", "Glob **/*.ts"),
			makeEvent("tool_call", "Read another.ts"),
			makeEvent("active"),
		];
		const result = classifyIntent(events);
		expect(result.intent).toBe("exploring");
		expect(result.confidence).toBe(4 / 5);
	});

	it("classifies testing for Bash with test commands", () => {
		const events = [
			makeEvent("tool_call", "Bash: npm test"),
			makeEvent("tool_call", "Read output.log"),
			makeEvent("active"),
		];
		const result = classifyIntent(events);
		expect(result.intent).toBe("testing");
		expect(result.confidence).toBe(1 / 3);
	});

	it("classifies testing for Bash with pytest", () => {
		const events = [
			makeEvent("tool_call", "Bash: pytest tests/"),
			makeEvent("tool_call", "Bash: pytest tests/unit"),
		];
		const result = classifyIntent(events);
		expect(result.intent).toBe("testing");
		expect(result.confidence).toBe(1.0);
	});

	it("classifies testing for Bash with vitest", () => {
		const events = [makeEvent("tool_call", "Bash: vitest run")];
		const result = classifyIntent(events);
		expect(result.intent).toBe("testing");
		expect(result.confidence).toBe(1.0);
	});

	it("classifies committing for Bash with git commands", () => {
		const events = [
			makeEvent("tool_call", 'Bash: git commit -m "fix"'),
			makeEvent("tool_call", "Bash: git push origin main"),
		];
		const result = classifyIntent(events);
		expect(result.intent).toBe("committing");
		expect(result.confidence).toBe(1.0);
	});

	it("classifies committing for git add", () => {
		const events = [
			makeEvent("tool_call", "Bash: git add file.ts"),
			makeEvent("active"),
			makeEvent("active"),
		];
		const result = classifyIntent(events);
		expect(result.intent).toBe("committing");
		expect(result.confidence).toBeCloseTo(1 / 3);
	});

	it("classifies debugging when error is followed by Read", () => {
		const events = [
			makeEvent("error", "TypeError: undefined"),
			makeEvent("tool_call", "Read src/broken.ts"),
			makeEvent("active"),
		];
		const result = classifyIntent(events);
		expect(result.intent).toBe("debugging");
		expect(result.confidence).toBeGreaterThan(0);
	});

	it("classifies implementing when majority are Write/Edit", () => {
		const events = [
			makeEvent("tool_call", "Write src/new.ts"),
			makeEvent("tool_call", "Edit src/existing.ts"),
			makeEvent("tool_call", "Write src/another.ts"),
			makeEvent("active"),
		];
		const result = classifyIntent(events);
		expect(result.intent).toBe("implementing");
		expect(result.confidence).toBe(3 / 4);
	});

	it("falls back to planning when no dominant pattern", () => {
		const events = [
			makeEvent("active"),
			makeEvent("tool_call", "Read file.ts"),
			makeEvent("tool_call", "Write other.ts"),
			makeEvent("active"),
		];
		const result = classifyIntent(events);
		expect(result.intent).toBe("planning");
		expect(result.confidence).toBe(0.5);
	});

	it("respects windowSize and only considers last N events", () => {
		const events = [
			// Older events (should be excluded with windowSize=3)
			makeEvent("tool_call", "Read a.ts"),
			makeEvent("tool_call", "Grep pattern"),
			makeEvent("tool_call", "Glob **/*"),
			makeEvent("tool_call", "Read b.ts"),
			makeEvent("tool_call", "Read c.ts"),
			// Recent events (last 3)
			makeEvent("tool_call", "Write new.ts"),
			makeEvent("tool_call", "Edit old.ts"),
			makeEvent("tool_call", "Write another.ts"),
		];
		const result = classifyIntent(events, 3);
		expect(result.intent).toBe("implementing");
	});

	it("uses default windowSize of 10", () => {
		// 12 events, only last 10 should be considered
		const events: AgentActivity[] = [
			makeEvent("tool_call", "Bash: pytest test.py"),
			makeEvent("tool_call", "Bash: pytest test2.py"),
			// next 10 are all Write/Edit
			...Array.from({ length: 10 }, (_, i) =>
				makeEvent("tool_call", i % 2 === 0 ? "Write file.ts" : "Edit file.ts"),
			),
		];
		const result = classifyIntent(events);
		expect(result.intent).toBe("implementing");
	});

	it("testing detected with mixed events when exploring is not majority", () => {
		const events = [
			makeEvent("tool_call", "Bash: vitest run"),
			makeEvent("tool_call", "Bash: npm test"),
			makeEvent("tool_call", "Read output.ts"),
			makeEvent("active"),
		];
		const result = classifyIntent(events);
		expect(result.intent).toBe("testing");
	});

	it("confidence reflects the ratio of matching events", () => {
		const events = [
			makeEvent("tool_call", "Read a.ts"),
			makeEvent("tool_call", "Grep x"),
			makeEvent("tool_call", "Glob *"),
			makeEvent("tool_call", "Read b.ts"),
			makeEvent("tool_call", "Read c.ts"),
			makeEvent("tool_call", "Read d.ts"),
			makeEvent("active"),
			makeEvent("active"),
			makeEvent("active"),
			makeEvent("active"),
		];
		const result = classifyIntent(events);
		expect(result.intent).toBe("exploring");
		expect(result.confidence).toBe(0.6);
	});
});
