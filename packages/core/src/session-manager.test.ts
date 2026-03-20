import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPathResolver } from "./paths.js";
import { FileSessionManager } from "./session-manager.js";
import type { Logger } from "./types.js";

function mockLogger(): Logger {
	return {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		child: vi.fn().mockReturnThis(),
	};
}

describe("FileSessionManager", () => {
	let tmpDir: string;
	let manager: FileSessionManager;

	beforeEach(async () => {
		tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "uc-session-"));
		const paths = createPathResolver("test-project", tmpDir);
		manager = new FileSessionManager(paths, mockLogger());
	});

	afterEach(async () => {
		await fs.promises.rm(tmpDir, { recursive: true, force: true });
	});

	it("creates a session", async () => {
		const session = await manager.create({
			projectId: "test",
			task: "Fix bug",
			agentType: "claude-code",
			workspacePath: "/tmp/ws",
			branch: "fix/bug",
			metadata: {},
		});

		expect(session.id).toBeTruthy();
		expect(session.status).toBe("spawning");
		expect(session.task).toBe("Fix bug");
	});

	it("gets a session by id", async () => {
		const created = await manager.create({
			projectId: "test",
			task: "task1",
			agentType: "claude-code",
			workspacePath: "/tmp",
			branch: "main",
			metadata: {},
		});

		const fetched = await manager.get(created.id);
		expect(fetched).toBeDefined();
		expect(fetched?.task).toBe("task1");
	});

	it("returns undefined for non-existent session", async () => {
		expect(await manager.get("nonexistent")).toBeUndefined();
	});

	it("updates a session", async () => {
		const session = await manager.create({
			projectId: "test",
			task: "task1",
			agentType: "claude-code",
			workspacePath: "/tmp",
			branch: "main",
			metadata: {},
		});

		const updated = await manager.update(session.id, { status: "working" });
		expect(updated.status).toBe("working");
		expect(updated.id).toBe(session.id);
	});

	it("lists sessions", async () => {
		await manager.create({
			projectId: "test",
			task: "task1",
			agentType: "claude-code",
			workspacePath: "/tmp",
			branch: "main",
			metadata: {},
		});
		await manager.create({
			projectId: "test",
			task: "task2",
			agentType: "claude-code",
			workspacePath: "/tmp",
			branch: "main",
			metadata: {},
		});

		const all = await manager.list();
		expect(all).toHaveLength(2);
	});

	it("filters by array of statuses", async () => {
		const s1 = await manager.create({
			projectId: "test",
			task: "task1",
			agentType: "claude-code",
			workspacePath: "/tmp",
			branch: "main",
			metadata: {},
		});
		const s2 = await manager.create({
			projectId: "test",
			task: "task2",
			agentType: "claude-code",
			workspacePath: "/tmp",
			branch: "main",
			metadata: {},
		});

		// Update one to "working"
		await manager.update(s1.id, { status: "working" });

		// Both are either "spawning" or "working"
		const both = await manager.list({ status: ["spawning", "working"] });
		expect(both).toHaveLength(2);

		// Only "working"
		const workingOnly = await manager.list({ status: ["working"] });
		expect(workingOnly).toHaveLength(1);
		expect(workingOnly[0].id).toBe(s1.id);

		// Only "merged" — should be empty
		const none = await manager.list({ status: ["merged"] });
		expect(none).toHaveLength(0);
	});

	it("filters by single status string", async () => {
		await manager.create({
			projectId: "test",
			task: "task1",
			agentType: "claude-code",
			workspacePath: "/tmp",
			branch: "main",
			metadata: {},
		});

		const spawning = await manager.list({ status: "spawning" });
		expect(spawning).toHaveLength(1);

		const working = await manager.list({ status: "working" });
		expect(working).toHaveLength(0);
	});

	it("transitions session via state machine event", async () => {
		const session = await manager.create({
			projectId: "test",
			task: "task1",
			agentType: "claude-code",
			workspacePath: "/tmp",
			branch: "main",
			metadata: {},
		});

		// spawning → working via "start"
		const working = await manager.transition(session.id, "start");
		expect(working.status).toBe("working");

		// working → pr_open via "open_pr"
		const prOpen = await manager.transition(session.id, "open_pr");
		expect(prOpen.status).toBe("pr_open");
	});

	it("rejects invalid state transitions", async () => {
		const session = await manager.create({
			projectId: "test",
			task: "task1",
			agentType: "claude-code",
			workspacePath: "/tmp",
			branch: "main",
			metadata: {},
		});

		// spawning → "merge" is invalid
		await expect(manager.transition(session.id, "merge")).rejects.toThrow(
			"Cannot transition from 'spawning' via 'merge'",
		);
	});

	it("deletes a session", async () => {
		const session = await manager.create({
			projectId: "test",
			task: "task1",
			agentType: "claude-code",
			workspacePath: "/tmp",
			branch: "main",
			metadata: {},
		});

		await manager.delete(session.id);
		expect(await manager.get(session.id)).toBeUndefined();
	});
});
