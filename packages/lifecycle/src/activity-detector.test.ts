import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectActivity, isStuck, parseJsonlString, readLastBytes } from "./activity-detector.js";

// ─── Helpers ─────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
	tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "activity-test-"));
});

afterEach(async () => {
	await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

function writeTmpFile(name: string, content: string): string {
	const filePath = path.join(tmpDir, name);
	fs.writeFileSync(filePath, content, "utf-8");
	return filePath;
}

function makeEvent(type: string, detail?: string): string {
	return JSON.stringify({
		type,
		timestamp: new Date().toISOString(),
		...(detail ? { detail } : {}),
	});
}

// ─── readLastBytes ───────────────────────────────────────────────────

describe("readLastBytes", () => {
	it("reads entire file when smaller than maxBytes", async () => {
		const filePath = writeTmpFile("small.jsonl", "line1\nline2\nline3\n");
		const content = await readLastBytes(filePath, 1024);
		expect(content).toBe("line1\nline2\nline3\n");
	});

	it("reads only last maxBytes and skips first partial line", async () => {
		// Create a file with known content
		const lines = [];
		for (let i = 0; i < 100; i++) {
			lines.push(`line-${String(i).padStart(4, "0")}-${"x".repeat(100)}`);
		}
		const fullContent = `${lines.join("\n")}\n`;
		const filePath = writeTmpFile("large.jsonl", fullContent);

		// Read only last 500 bytes
		const content = await readLastBytes(filePath, 500);

		// Should not start with "line-" since we skip the first partial line
		// The content should be shorter than fullContent
		expect(content.length).toBeLessThan(fullContent.length);

		// Each complete line should be well-formed
		const resultLines = content.split("\n").filter((l) => l.length > 0);
		for (const line of resultLines) {
			expect(line).toMatch(/^line-\d{4}-x+$/);
		}
	});

	it("returns content even without a newline (single partial line)", async () => {
		// A file with no newlines that is bigger than maxBytes
		const bigLine = "x".repeat(200);
		const filePath = writeTmpFile("noline.txt", bigLine);

		const content = await readLastBytes(filePath, 50);
		// No newline found, so returns all 50 bytes as-is
		expect(content.length).toBe(50);
	});

	it("throws on non-existent file", async () => {
		await expect(readLastBytes("/nonexistent/file.jsonl", 1024)).rejects.toThrow();
	});
});

// ─── parseJsonlString ────────────────────────────────────────────────

describe("parseJsonlString", () => {
	it("parses valid JSONL lines", () => {
		const input = '{"a":1}\n{"b":2}\n{"c":3}\n';
		const result = parseJsonlString<Record<string, number>>(input);
		expect(result).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
	});

	it("skips blank lines", () => {
		const input = '{"a":1}\n\n\n{"b":2}\n';
		const result = parseJsonlString(input);
		expect(result).toHaveLength(2);
	});

	it("skips malformed JSON lines", () => {
		const input = '{"a":1}\nnot-json\n{"b":2}\n';
		const result = parseJsonlString(input);
		expect(result).toHaveLength(2);
	});

	it("returns empty array for empty string", () => {
		expect(parseJsonlString("")).toEqual([]);
		expect(parseJsonlString("\n\n")).toEqual([]);
	});
});

// ─── detectActivity with 128KB tail ──────────────────────────────────

describe("detectActivity", () => {
	it("returns empty summary for missing file", async () => {
		const result = await detectActivity(path.join(tmpDir, "missing.jsonl"));
		expect(result.lastActivity).toBeNull();
		expect(result.totalEvents).toBe(0);
		expect(result.isActive).toBe(false);
	});

	it("returns empty summary for empty file", async () => {
		const filePath = writeTmpFile("empty.jsonl", "");
		const result = await detectActivity(filePath);
		expect(result.lastActivity).toBeNull();
		expect(result.totalEvents).toBe(0);
	});

	it("detects active status from last event", async () => {
		const content = [
			makeEvent("idle"),
			makeEvent("tool_call", "Edit file.ts"),
			makeEvent("active"),
		].join("\n");
		const filePath = writeTmpFile("active.jsonl", `${content}\n`);

		const result = await detectActivity(filePath);
		expect(result.isActive).toBe(true);
		expect(result.lastActivity?.type).toBe("active");
		expect(result.totalEvents).toBe(3);
	});

	it("detects completed status", async () => {
		const content = [makeEvent("active"), makeEvent("completed")].join("\n");
		const filePath = writeTmpFile("completed.jsonl", `${content}\n`);

		const result = await detectActivity(filePath);
		expect(result.isCompleted).toBe(true);
	});

	it("detects idle status with idleSince", async () => {
		const ts = new Date().toISOString();
		const content = JSON.stringify({ type: "idle", timestamp: ts });
		const filePath = writeTmpFile("idle.jsonl", `${content}\n`);

		const result = await detectActivity(filePath);
		expect(result.idleSince).toBe(ts);
		expect(result.isActive).toBe(false);
	});

	it("only reads last maxBytes of a large file", async () => {
		// Create a file larger than our test maxBytes
		const events: string[] = [];
		for (let i = 0; i < 200; i++) {
			events.push(makeEvent("tool_call", `Step-${i}-${"y".repeat(50)}`));
		}
		// Last event is "completed"
		events.push(makeEvent("completed"));
		const filePath = writeTmpFile("big.jsonl", `${events.join("\n")}\n`);

		// Use a small maxBytes to ensure tail behavior
		const result = await detectActivity(filePath, 512);

		expect(result.isCompleted).toBe(true);
		// totalEvents should be less than 201 since we only read tail
		expect(result.totalEvents).toBeLessThan(201);
		expect(result.totalEvents).toBeGreaterThan(0);
	});
});

// ─── isStuck ─────────────────────────────────────────────────────────

describe("isStuck", () => {
	it("returns false when not idle", () => {
		expect(
			isStuck(
				{
					lastActivity: { type: "active", timestamp: new Date().toISOString() },
					idleSince: null,
					isActive: true,
					isCompleted: false,
					totalEvents: 1,
				},
				60_000,
			),
		).toBe(false);
	});

	it("returns true when idle longer than threshold", () => {
		const tenMinAgo = new Date(Date.now() - 600_000).toISOString();
		expect(
			isStuck(
				{
					lastActivity: { type: "idle", timestamp: tenMinAgo },
					idleSince: tenMinAgo,
					isActive: false,
					isCompleted: false,
					totalEvents: 1,
				},
				300_000, // 5 min threshold
			),
		).toBe(true);
	});

	it("returns false when idle less than threshold", () => {
		const oneMinAgo = new Date(Date.now() - 60_000).toISOString();
		expect(
			isStuck(
				{
					lastActivity: { type: "idle", timestamp: oneMinAgo },
					idleSince: oneMinAgo,
					isActive: false,
					isCompleted: false,
					totalEvents: 1,
				},
				300_000,
			),
		).toBe(false);
	});
});
