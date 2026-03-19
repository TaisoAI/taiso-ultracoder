import { describe, expect, it } from "vitest";
import { canTransition, validEvents } from "./state-machine.js";

describe("canTransition", () => {
	// ─── Happy path: spawning through merge ─────────────────────────
	it("allows spawning -> working via start", () => {
		const result = canTransition("spawning", "start");
		expect(result.valid).toBe(true);
		expect(result.to).toBe("working");
	});

	it("allows working -> pr_open via open_pr", () => {
		const result = canTransition("working", "open_pr");
		expect(result.valid).toBe(true);
		expect(result.to).toBe("pr_open");
	});

	it("allows pr_open -> review_pending via request_review", () => {
		const result = canTransition("pr_open", "request_review");
		expect(result.valid).toBe(true);
		expect(result.to).toBe("review_pending");
	});

	it("allows review_pending -> approved via approve", () => {
		const result = canTransition("review_pending", "approve");
		expect(result.valid).toBe(true);
		expect(result.to).toBe("approved");
	});

	it("allows approved -> mergeable via make_mergeable", () => {
		const result = canTransition("approved", "make_mergeable");
		expect(result.valid).toBe(true);
		expect(result.to).toBe("mergeable");
	});

	it("allows mergeable -> merged via merge", () => {
		const result = canTransition("mergeable", "merge");
		expect(result.valid).toBe(true);
		expect(result.to).toBe("merged");
	});

	it("allows merged -> archived via archive", () => {
		const result = canTransition("merged", "archive");
		expect(result.valid).toBe(true);
		expect(result.to).toBe("archived");
	});

	// ─── CI failure paths ───────────────────────────────────────────
	it("allows pr_open -> ci_failed via ci_fail", () => {
		const result = canTransition("pr_open", "ci_fail");
		expect(result.valid).toBe(true);
		expect(result.to).toBe("ci_failed");
	});

	it("allows review_pending -> ci_failed via ci_fail", () => {
		const result = canTransition("review_pending", "ci_fail");
		expect(result.valid).toBe(true);
	});

	it("allows approved -> ci_failed via ci_fail", () => {
		const result = canTransition("approved", "ci_fail");
		expect(result.valid).toBe(true);
	});

	it("allows ci_failed -> working via resolve (retry)", () => {
		const result = canTransition("ci_failed", "resolve");
		expect(result.valid).toBe(true);
		expect(result.to).toBe("working");
	});

	// ─── Changes requested path ─────────────────────────────────────
	it("allows review_pending -> changes_requested via request_changes", () => {
		const result = canTransition("review_pending", "request_changes");
		expect(result.valid).toBe(true);
		expect(result.to).toBe("changes_requested");
	});

	it("allows changes_requested -> working via resolve (address feedback)", () => {
		const result = canTransition("changes_requested", "resolve");
		expect(result.valid).toBe(true);
		expect(result.to).toBe("working");
	});

	// ─── Merge conflicts path ───────────────────────────────────────
	it("allows pr_open -> merge_conflicts via conflict", () => {
		const result = canTransition("pr_open", "conflict");
		expect(result.valid).toBe(true);
		expect(result.to).toBe("merge_conflicts");
	});

	it("allows mergeable -> merge_conflicts via conflict", () => {
		const result = canTransition("mergeable", "conflict");
		expect(result.valid).toBe(true);
	});

	it("allows merge_conflicts -> working via resolve", () => {
		const result = canTransition("merge_conflicts", "resolve");
		expect(result.valid).toBe(true);
		expect(result.to).toBe("working");
	});

	// ─── Generic failure path ───────────────────────────────────────
	it("allows working -> failed via fail", () => {
		const result = canTransition("working", "fail");
		expect(result.valid).toBe(true);
		expect(result.to).toBe("failed");
	});

	it("allows failed -> working via start (retry)", () => {
		const result = canTransition("failed", "start");
		expect(result.valid).toBe(true);
		expect(result.to).toBe("working");
	});

	it("allows failed -> archived via archive", () => {
		const result = canTransition("failed", "archive");
		expect(result.valid).toBe(true);
	});

	// ─── Kill from any non-terminal state ───────────────────────────
	it("allows kill from spawning", () => {
		expect(canTransition("spawning", "kill").valid).toBe(true);
	});

	it("allows kill from working", () => {
		expect(canTransition("working", "kill").valid).toBe(true);
	});

	it("allows kill from pr_open", () => {
		expect(canTransition("pr_open", "kill").valid).toBe(true);
	});

	it("allows kill from review_pending", () => {
		expect(canTransition("review_pending", "kill").valid).toBe(true);
	});

	it("allows kill from approved", () => {
		expect(canTransition("approved", "kill").valid).toBe(true);
	});

	it("allows kill from mergeable", () => {
		expect(canTransition("mergeable", "kill").valid).toBe(true);
	});

	it("allows killed -> archived via archive", () => {
		const result = canTransition("killed", "archive");
		expect(result.valid).toBe(true);
	});

	// ─── Invalid transitions ────────────────────────────────────────
	it("rejects archived -> anything", () => {
		expect(canTransition("archived", "start").valid).toBe(false);
		expect(canTransition("archived", "kill").valid).toBe(false);
		expect(canTransition("archived", "archive").valid).toBe(false);
	});

	it("rejects merged -> working", () => {
		const result = canTransition("merged", "start");
		expect(result.valid).toBe(false);
		expect(result.reason).toBeDefined();
	});

	it("rejects spawning -> pr_open (must go through working)", () => {
		expect(canTransition("spawning", "open_pr").valid).toBe(false);
	});

	it("rejects working -> approved (must go through PR review)", () => {
		expect(canTransition("working", "approve").valid).toBe(false);
	});

	it("provides a reason string for invalid transitions", () => {
		const result = canTransition("archived", "start");
		expect(result.reason).toContain("Cannot transition");
		expect(result.reason).toContain("archived");
		expect(result.reason).toContain("start");
	});
});

describe("validEvents", () => {
	it("spawning can start, resolve, or be killed", () => {
		const events = validEvents("spawning");
		expect(events).toContain("start");
		expect(events).toContain("kill");
		expect(events.length).toBeGreaterThanOrEqual(2);
	});

	it("working can open_pr, fail, or be killed", () => {
		const events = validEvents("working");
		expect(events).toContain("open_pr");
		expect(events).toContain("fail");
		expect(events).toContain("kill");
		expect(events).toHaveLength(3);
	});

	it("pr_open can request_review, ci_fail, conflict, or be killed", () => {
		const events = validEvents("pr_open");
		expect(events).toContain("request_review");
		expect(events).toContain("ci_fail");
		expect(events).toContain("conflict");
		expect(events).toContain("kill");
		expect(events).toHaveLength(4);
	});

	it("review_pending can approve, request_changes, ci_fail, or be killed", () => {
		const events = validEvents("review_pending");
		expect(events).toContain("approve");
		expect(events).toContain("request_changes");
		expect(events).toContain("ci_fail");
		expect(events).toContain("kill");
		expect(events).toHaveLength(4);
	});

	it("approved can ci_pass, make_mergeable, ci_fail, or be killed", () => {
		const events = validEvents("approved");
		expect(events).toContain("ci_pass");
		expect(events).toContain("make_mergeable");
		expect(events).toContain("ci_fail");
		expect(events).toContain("kill");
		expect(events).toHaveLength(4);
	});

	it("mergeable can merge, conflict, or be killed", () => {
		const events = validEvents("mergeable");
		expect(events).toContain("merge");
		expect(events).toContain("conflict");
		expect(events).toContain("kill");
		expect(events).toHaveLength(3);
	});

	it("ci_failed can resolve, be killed, or archived", () => {
		const events = validEvents("ci_failed");
		expect(events).toContain("resolve");
		expect(events).toContain("kill");
		expect(events).toContain("archive");
		expect(events).toHaveLength(3);
	});

	it("changes_requested can resolve, be killed, or archived", () => {
		const events = validEvents("changes_requested");
		expect(events).toContain("resolve");
		expect(events).toContain("kill");
		expect(events).toContain("archive");
		expect(events).toHaveLength(3);
	});

	it("merge_conflicts can resolve, be killed, or archived", () => {
		const events = validEvents("merge_conflicts");
		expect(events).toContain("resolve");
		expect(events).toContain("kill");
		expect(events).toContain("archive");
		expect(events).toHaveLength(3);
	});

	it("failed can start (retry), be killed, or archived", () => {
		const events = validEvents("failed");
		expect(events).toContain("start");
		expect(events).toContain("kill");
		expect(events).toContain("archive");
		expect(events).toHaveLength(3);
	});

	it("merged can only be archived", () => {
		const events = validEvents("merged");
		expect(events).toEqual(["archive"]);
	});

	it("killed can only be archived", () => {
		const events = validEvents("killed");
		expect(events).toEqual(["archive"]);
	});

	it("archived has no valid events", () => {
		expect(validEvents("archived")).toHaveLength(0);
	});
});

describe("PR lifecycle: full happy path", () => {
	it("traverses spawning -> working -> pr_open -> review_pending -> approved -> mergeable -> merged -> archived", () => {
		const steps: Array<{ event: Parameters<typeof canTransition>[1]; from: string }> = [
			{ from: "spawning", event: "start" },
			{ from: "working", event: "open_pr" },
			{ from: "pr_open", event: "request_review" },
			{ from: "review_pending", event: "approve" },
			{ from: "approved", event: "make_mergeable" },
			{ from: "mergeable", event: "merge" },
			{ from: "merged", event: "archive" },
		];

		let currentStatus = "spawning";
		for (const step of steps) {
			expect(currentStatus).toBe(step.from);
			const result = canTransition(
				currentStatus as Parameters<typeof canTransition>[0],
				step.event,
			);
			expect(result.valid).toBe(true);
			currentStatus = result.to;
		}
		expect(currentStatus).toBe("archived");
	});
});

describe("PR lifecycle: CI failure and retry", () => {
	it("recovers from CI failure back through the PR flow", () => {
		// working -> pr_open -> ci_failed -> working (retry) -> pr_open
		expect(canTransition("working", "open_pr").valid).toBe(true);
		expect(canTransition("pr_open", "ci_fail").valid).toBe(true);
		expect(canTransition("ci_failed", "resolve").valid).toBe(true);
		// Back to working, can open PR again
		expect(canTransition("working", "open_pr").valid).toBe(true);
	});
});

describe("PR lifecycle: changes requested and rework", () => {
	it("recovers from changes_requested back through the PR flow", () => {
		expect(canTransition("review_pending", "request_changes").valid).toBe(true);
		expect(canTransition("changes_requested", "resolve").valid).toBe(true);
		// Back to working, can open PR again
		expect(canTransition("working", "open_pr").valid).toBe(true);
	});
});

describe("PR lifecycle: merge conflict resolution", () => {
	it("recovers from merge_conflicts back through the flow", () => {
		expect(canTransition("mergeable", "conflict").valid).toBe(true);
		expect(canTransition("merge_conflicts", "resolve").valid).toBe(true);
		// Back to working
		expect(canTransition("working", "open_pr").valid).toBe(true);
	});
});
