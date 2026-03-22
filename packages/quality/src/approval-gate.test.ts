import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApprovalGate } from "./approval-gate.js";

describe("ApprovalGate", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "approval-gate-"));
	});

	afterEach(async () => {
		await fs.promises.rm(tmpDir, { recursive: true, force: true });
	});

	it("requestApproval creates a pending record with correct fields", async () => {
		const gate = new ApprovalGate(tmpDir);
		const approval = await gate.requestApproval({
			sessionId: "sess-1",
			tool: "bash:rm -rf /tmp/foo",
			context: "Deleting temp directory",
		});

		expect(approval.id).toHaveLength(8);
		expect(approval.sessionId).toBe("sess-1");
		expect(approval.tool).toBe("bash:rm -rf /tmp/foo");
		expect(approval.context).toBe("Deleting temp directory");
		expect(approval.status).toBe("pending");
		expect(approval.timeoutMs).toBe(300_000);
		expect(approval.requestedAt).toBeTruthy();
		expect(approval.resolvedAt).toBeUndefined();
		expect(approval.reason).toBeUndefined();
	});

	it("respond('approve') transitions status to approved", async () => {
		const gate = new ApprovalGate(tmpDir);
		const approval = await gate.requestApproval({
			sessionId: "sess-1",
			tool: "bash:git push",
			context: "Push to remote",
		});

		const result = await gate.respond(approval.id, "approve");
		expect(result.status).toBe("approved");
		expect(result.resolvedAt).toBeTruthy();
	});

	it("respond('deny') transitions status to denied with reason", async () => {
		const gate = new ApprovalGate(tmpDir);
		const approval = await gate.requestApproval({
			sessionId: "sess-1",
			tool: "bash:rm -rf /",
			context: "Dangerous command",
		});

		const result = await gate.respond(approval.id, "deny", "Too dangerous");
		expect(result.status).toBe("denied");
		expect(result.reason).toBe("Too dangerous");
		expect(result.resolvedAt).toBeTruthy();
	});

	it("getPending returns only pending items", async () => {
		const gate = new ApprovalGate(tmpDir);
		const a1 = await gate.requestApproval({
			sessionId: "sess-1",
			tool: "tool-a",
			context: "ctx-a",
		});
		await gate.requestApproval({
			sessionId: "sess-1",
			tool: "tool-b",
			context: "ctx-b",
		});
		await gate.respond(a1.id, "approve");

		const pending = await gate.getPending();
		expect(pending).toHaveLength(1);
		expect(pending[0].tool).toBe("tool-b");
	});

	it("sweepTimeouts marks expired approvals as timed_out", async () => {
		const gate = new ApprovalGate(tmpDir);
		const approval = await gate.requestApproval({
			sessionId: "sess-1",
			tool: "bash:slow-task",
			context: "Will timeout",
			timeoutMs: 1, // 1ms timeout — will expire immediately
		});

		// Small delay to ensure timeout
		await new Promise((resolve) => setTimeout(resolve, 10));

		const count = await gate.sweepTimeouts();
		expect(count).toBe(1);

		const updated = await gate.get(approval.id);
		expect(updated?.status).toBe("timed_out");
		expect(updated?.resolvedAt).toBeTruthy();
	});

	it("throws when responding to non-existent ID", async () => {
		const gate = new ApprovalGate(tmpDir);
		await expect(gate.respond("nonexistent", "approve")).rejects.toThrow(
			"Approval 'nonexistent' not found",
		);
	});

	it("double-respond is idempotent", async () => {
		const gate = new ApprovalGate(tmpDir);
		const approval = await gate.requestApproval({
			sessionId: "sess-1",
			tool: "bash:deploy",
			context: "Deploy to prod",
		});

		const first = await gate.respond(approval.id, "approve");
		const second = await gate.respond(approval.id, "deny", "Changed my mind");

		// Second call returns the original resolved state
		expect(second.status).toBe("approved");
		expect(second.resolvedAt).toBe(first.resolvedAt);
		expect(second.reason).toBeUndefined();
	});

	it("requestApproval uses custom timeoutMs", async () => {
		const gate = new ApprovalGate(tmpDir);
		const approval = await gate.requestApproval({
			sessionId: "sess-1",
			tool: "tool",
			context: "ctx",
			timeoutMs: 60_000,
		});
		expect(approval.timeoutMs).toBe(60_000);
	});

	it("persists approvals across gate instances", async () => {
		const gate1 = new ApprovalGate(tmpDir);
		const approval = await gate1.requestApproval({
			sessionId: "sess-1",
			tool: "bash:deploy",
			context: "Deploy",
		});

		// New instance reading the same directory
		const gate2 = new ApprovalGate(tmpDir);
		const loaded = await gate2.get(approval.id);
		expect(loaded).toBeDefined();
		expect(loaded!.tool).toBe("bash:deploy");
		expect(loaded!.status).toBe("pending");

		// Respond via second instance
		const result = await gate2.respond(approval.id, "approve");
		expect(result.status).toBe("approved");
	});
});
