import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mapGitHubEvent, verifyGitHubSignature } from "./webhooks.js";

describe("verifyGitHubSignature", () => {
	const secret = "test-secret-key";

	function makeSignature(payload: string, key: string): string {
		const hmac = createHmac("sha256", key).update(payload).digest("hex");
		return `sha256=${hmac}`;
	}

	it("returns true for a valid signature", () => {
		const payload = '{"action":"opened"}';
		const signature = makeSignature(payload, secret);
		expect(verifyGitHubSignature(payload, signature, secret)).toBe(true);
	});

	it("returns false for an invalid signature", () => {
		const payload = '{"action":"opened"}';
		const signature = "sha256=invalid0000000000000000000000000000000000000000000000000000000000";
		expect(verifyGitHubSignature(payload, signature, secret)).toBe(false);
	});

	it("returns false for a tampered payload", () => {
		const payload = '{"action":"opened"}';
		const signature = makeSignature(payload, secret);
		expect(verifyGitHubSignature('{"action":"closed"}', signature, secret)).toBe(false);
	});

	it("returns false for wrong secret", () => {
		const payload = '{"action":"opened"}';
		const signature = makeSignature(payload, "wrong-secret");
		expect(verifyGitHubSignature(payload, signature, secret)).toBe(false);
	});
});

describe("mapGitHubEvent", () => {
	it("maps pull_request opened to pr.opened", () => {
		const event = mapGitHubEvent("pull_request", {
			action: "opened",
			pull_request: { id: 123, number: 42, html_url: "https://github.com/test/pr/42" },
		});
		expect(event).not.toBeNull();
		expect(event!.type).toBe("pr.opened");
		if (event!.type === "pr.opened") {
			expect(event!.prId).toBe("42");
			expect(event!.timestamp).toBeDefined();
		}
	});

	it("maps pull_request closed+merged to pr.merged", () => {
		const event = mapGitHubEvent("pull_request", {
			action: "closed",
			pull_request: { id: 123, number: 42, merged: true },
		});
		expect(event).not.toBeNull();
		expect(event!.type).toBe("pr.merged");
	});

	it("returns null for pull_request closed without merge", () => {
		const event = mapGitHubEvent("pull_request", {
			action: "closed",
			pull_request: { id: 123, number: 42, merged: false },
		});
		expect(event).toBeNull();
	});

	it("maps check_suite failure to ci.failed", () => {
		const event = mapGitHubEvent("check_suite", {
			conclusion: "failure",
			check_suite: { id: 456, head_sha: "abc123" },
		});
		expect(event).not.toBeNull();
		expect(event!.type).toBe("ci.failed");
		if (event!.type === "ci.failed") {
			expect(event!.ref).toBe("abc123");
		}
	});

	it("maps check_suite success to ci.passed", () => {
		const event = mapGitHubEvent("check_suite", {
			conclusion: "success",
			check_suite: { id: 456, head_sha: "def456" },
		});
		expect(event).not.toBeNull();
		expect(event!.type).toBe("ci.passed");
	});

	it("maps pull_request_review submitted to pr.reviewed", () => {
		const event = mapGitHubEvent("pull_request_review", {
			action: "submitted",
			review: { state: "approved" },
			pull_request: { id: 123, number: 42 },
		});
		expect(event).not.toBeNull();
		expect(event!.type).toBe("pr.reviewed");
		if (event!.type === "pr.reviewed") {
			expect(event!.decision).toBe("approved");
		}
	});

	it("returns null for unknown event types", () => {
		const event = mapGitHubEvent("unknown_event", {});
		expect(event).toBeNull();
	});
});
