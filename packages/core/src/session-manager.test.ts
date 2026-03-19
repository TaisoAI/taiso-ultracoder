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
