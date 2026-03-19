import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ScopeTracker, executeHandoff } from "./scope-tracker.js";

describe("ScopeTracker", () => {
	it("acquires scope without conflict", async () => {
		const tracker = new ScopeTracker();
		const conflict = await tracker.acquire("session-1", ["src/a.ts", "src/b.ts"]);
		expect(conflict).toBeNull();
	});

	it("detects overlap", async () => {
		const tracker = new ScopeTracker();
		await tracker.acquire("session-1", ["src/a.ts", "src/b.ts"]);
		const conflict = await tracker.acquire("session-2", ["src/b.ts", "src/c.ts"]);
		expect(conflict).toBe("session-1");
	});

	it("allows non-overlapping scopes", async () => {
		const tracker = new ScopeTracker();
		await tracker.acquire("session-1", ["src/a.ts"]);
		const conflict = await tracker.acquire("session-2", ["src/b.ts"]);
		expect(conflict).toBeNull();
	});

	it("release frees scope", async () => {
		const tracker = new ScopeTracker();
		await tracker.acquire("session-1", ["src/a.ts"]);
		await tracker.release("session-1");
		const conflict = await tracker.acquire("session-2", ["src/a.ts"]);
		expect(conflict).toBeNull();
	});

	it("owner returns correct session", async () => {
		const tracker = new ScopeTracker();
		await tracker.acquire("session-1", ["src/a.ts"]);
		expect(tracker.owner("src/a.ts")).toBe("session-1");
		expect(tracker.owner("src/b.ts")).toBeNull();
	});
});

describe("executeHandoff", () => {
	it("transfers files between sessions", async () => {
		const tracker = new ScopeTracker();
		await tracker.acquire("from", ["src/a.ts", "src/b.ts"]);
		const result = await executeHandoff(tracker, {
			fromSession: "from",
			toSession: "to",
			files: ["src/a.ts"],
			reason: "task complete",
		});
		expect(result).toBe(true);
		expect(tracker.owner("src/a.ts")).toBe("to");
		expect(tracker.owner("src/b.ts")).toBe("from");
	});
});

describe("ScopeTracker persistence", () => {
	let tmpDir: string;
	let logPath: string;

	beforeEach(async () => {
		tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "scope-test-"));
		logPath = path.join(tmpDir, "scope.jsonl");
	});

	afterEach(async () => {
		await fs.promises.rm(tmpDir, { recursive: true, force: true });
	});

	it("persists acquire and release events to JSONL", async () => {
		const tracker = new ScopeTracker(logPath);
		await tracker.acquire("s1", ["a.ts", "b.ts"]);
		await tracker.acquire("s2", ["c.ts"]);
		await tracker.release("s1");

		const content = await fs.promises.readFile(logPath, "utf-8");
		const lines = content
			.trim()
			.split("\n")
			.map((l) => JSON.parse(l));

		expect(lines).toHaveLength(3);
		expect(lines[0].type).toBe("acquire");
		expect(lines[0].sessionId).toBe("s1");
		expect(lines[0].files).toEqual(["a.ts", "b.ts"]);
		expect(lines[1].type).toBe("acquire");
		expect(lines[1].sessionId).toBe("s2");
		expect(lines[2].type).toBe("release");
		expect(lines[2].sessionId).toBe("s1");
	});

	it("persists handoff events to JSONL", async () => {
		const tracker = new ScopeTracker(logPath);
		await tracker.acquire("from", ["a.ts", "b.ts"]);
		await executeHandoff(tracker, {
			fromSession: "from",
			toSession: "to",
			files: ["a.ts"],
			reason: "done",
		});

		const content = await fs.promises.readFile(logPath, "utf-8");
		const lines = content
			.trim()
			.split("\n")
			.map((l) => JSON.parse(l));

		expect(lines).toHaveLength(2);
		expect(lines[0].type).toBe("acquire");
		expect(lines[1].type).toBe("handoff");
		expect(lines[1].fromSession).toBe("from");
		expect(lines[1].toSession).toBe("to");
		expect(lines[1].files).toEqual(["a.ts"]);
	});

	it("reconstructs state from JSONL log via fromLog", async () => {
		// Create initial tracker and perform operations
		const tracker1 = new ScopeTracker(logPath);
		await tracker1.acquire("s1", ["a.ts", "b.ts"]);
		await tracker1.acquire("s2", ["c.ts"]);
		await tracker1.release("s1");
		await tracker1.acquire("s3", ["a.ts", "d.ts"]);

		// Reconstruct from log
		const tracker2 = await ScopeTracker.fromLog(logPath);

		// Verify state matches
		expect(tracker2.owner("a.ts")).toBe("s3");
		expect(tracker2.owner("b.ts")).toBeNull(); // s1 was released
		expect(tracker2.owner("c.ts")).toBe("s2");
		expect(tracker2.owner("d.ts")).toBe("s3");
	});

	it("reconstructs handoff state from JSONL log", async () => {
		const tracker1 = new ScopeTracker(logPath);
		await tracker1.acquire("from", ["a.ts", "b.ts"]);
		await tracker1.acquire("to", ["c.ts"]);
		await executeHandoff(tracker1, {
			fromSession: "from",
			toSession: "to",
			files: ["a.ts"],
			reason: "done",
		});

		// Reconstruct
		const tracker2 = await ScopeTracker.fromLog(logPath);

		expect(tracker2.owner("a.ts")).toBe("to");
		expect(tracker2.owner("b.ts")).toBe("from");
		expect(tracker2.owner("c.ts")).toBe("to");
	});

	it("does not persist conflicting acquire events", async () => {
		const tracker = new ScopeTracker(logPath);
		await tracker.acquire("s1", ["a.ts"]);
		const conflict = await tracker.acquire("s2", ["a.ts"]);
		expect(conflict).toBe("s1");

		const content = await fs.promises.readFile(logPath, "utf-8");
		const lines = content
			.trim()
			.split("\n")
			.map((l) => JSON.parse(l));

		// Only the successful acquire should be persisted
		expect(lines).toHaveLength(1);
		expect(lines[0].sessionId).toBe("s1");
	});

	it("reconstructed tracker continues persisting to same log", async () => {
		const tracker1 = new ScopeTracker(logPath);
		await tracker1.acquire("s1", ["a.ts"]);

		// Reconstruct and continue
		const tracker2 = await ScopeTracker.fromLog(logPath);
		await tracker2.acquire("s2", ["b.ts"]);

		const content = await fs.promises.readFile(logPath, "utf-8");
		const lines = content
			.trim()
			.split("\n")
			.map((l) => JSON.parse(l));

		expect(lines).toHaveLength(2);
		expect(lines[1].sessionId).toBe("s2");
	});

	it("fromLog with missing file returns empty tracker", async () => {
		const tracker = await ScopeTracker.fromLog(path.join(tmpDir, "nonexistent.jsonl"));
		expect(tracker.owner("anything")).toBeNull();
		expect(tracker.getAll().size).toBe(0);
	});

	it("backward compatibility: no persistPath works as in-memory only", async () => {
		const tracker = new ScopeTracker();
		await tracker.acquire("s1", ["a.ts"]);
		expect(tracker.owner("a.ts")).toBe("s1");
		await tracker.release("s1");
		expect(tracker.owner("a.ts")).toBeNull();
	});

	it("events include timestamps", async () => {
		const tracker = new ScopeTracker(logPath);
		await tracker.acquire("s1", ["a.ts"]);

		const content = await fs.promises.readFile(logPath, "utf-8");
		const event = JSON.parse(content.trim());

		expect(event.timestamp).toBeDefined();
		// Should be valid ISO string
		expect(new Date(event.timestamp).toISOString()).toBe(event.timestamp);
	});
});
