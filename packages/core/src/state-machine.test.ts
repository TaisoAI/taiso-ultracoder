import { describe, expect, it } from "vitest";
import {
	SESSION_TRANSITIONS,
	type SessionEvent,
	canTransition,
	validEvents,
} from "./state-machine.js";
import type { SessionStatus } from "./types.js";

describe("canTransition", () => {
	// ── Valid transitions from each state ──────────────────────────────

	describe("spawning", () => {
		it("transitions to working via start", () => {
			const result = canTransition("spawning", "start");
			expect(result).toEqual({ valid: true, from: "spawning", to: "working", event: "start" });
		});

		it("transitions to killed via kill", () => {
			const result = canTransition("spawning", "kill");
			expect(result).toEqual({ valid: true, from: "spawning", to: "killed", event: "kill" });
		});
	});

	describe("working", () => {
		it("transitions to pr_open via open_pr", () => {
			const result = canTransition("working", "open_pr");
			expect(result).toEqual({ valid: true, from: "working", to: "pr_open", event: "open_pr" });
		});

		it("transitions to failed via fail", () => {
			const result = canTransition("working", "fail");
			expect(result).toEqual({ valid: true, from: "working", to: "failed", event: "fail" });
		});

		it("transitions to killed via kill", () => {
			const result = canTransition("working", "kill");
			expect(result).toEqual({ valid: true, from: "working", to: "killed", event: "kill" });
		});
	});

	describe("pr_open", () => {
		it("transitions to review_pending via request_review", () => {
			const result = canTransition("pr_open", "request_review");
			expect(result).toEqual({
				valid: true,
				from: "pr_open",
				to: "review_pending",
				event: "request_review",
			});
		});

		it("transitions to ci_failed via ci_fail", () => {
			const result = canTransition("pr_open", "ci_fail");
			expect(result).toEqual({ valid: true, from: "pr_open", to: "ci_failed", event: "ci_fail" });
		});

		it("transitions to merge_conflicts via conflict", () => {
			const result = canTransition("pr_open", "conflict");
			expect(result).toEqual({
				valid: true,
				from: "pr_open",
				to: "merge_conflicts",
				event: "conflict",
			});
		});
	});

	describe("review_pending", () => {
		it("transitions to approved via approve", () => {
			const result = canTransition("review_pending", "approve");
			expect(result).toEqual({
				valid: true,
				from: "review_pending",
				to: "approved",
				event: "approve",
			});
		});

		it("transitions to changes_requested via request_changes", () => {
			const result = canTransition("review_pending", "request_changes");
			expect(result).toEqual({
				valid: true,
				from: "review_pending",
				to: "changes_requested",
				event: "request_changes",
			});
		});

		it("transitions to ci_failed via ci_fail", () => {
			const result = canTransition("review_pending", "ci_fail");
			expect(result).toEqual({
				valid: true,
				from: "review_pending",
				to: "ci_failed",
				event: "ci_fail",
			});
		});
	});

	describe("approved", () => {
		it("transitions to mergeable via ci_pass", () => {
			const result = canTransition("approved", "ci_pass");
			expect(result).toEqual({
				valid: true,
				from: "approved",
				to: "mergeable",
				event: "ci_pass",
			});
		});

		it("transitions to mergeable via make_mergeable", () => {
			const result = canTransition("approved", "make_mergeable");
			expect(result).toEqual({
				valid: true,
				from: "approved",
				to: "mergeable",
				event: "make_mergeable",
			});
		});

		it("transitions to ci_failed via ci_fail", () => {
			const result = canTransition("approved", "ci_fail");
			expect(result).toEqual({
				valid: true,
				from: "approved",
				to: "ci_failed",
				event: "ci_fail",
			});
		});
	});

	describe("mergeable", () => {
		it("transitions to merged via merge", () => {
			const result = canTransition("mergeable", "merge");
			expect(result).toEqual({ valid: true, from: "mergeable", to: "merged", event: "merge" });
		});

		it("transitions to merge_conflicts via conflict", () => {
			const result = canTransition("mergeable", "conflict");
			expect(result).toEqual({
				valid: true,
				from: "mergeable",
				to: "merge_conflicts",
				event: "conflict",
			});
		});
	});

	describe("merged", () => {
		it("transitions to archived via archive", () => {
			const result = canTransition("merged", "archive");
			expect(result).toEqual({ valid: true, from: "merged", to: "archived", event: "archive" });
		});
	});

	describe("error/recovery states", () => {
		for (const state of ["ci_failed", "changes_requested", "merge_conflicts"] as const) {
			it(`${state} transitions to working via resolve`, () => {
				const result = canTransition(state, "resolve");
				expect(result).toEqual({ valid: true, from: state, to: "working", event: "resolve" });
			});

			it(`${state} transitions to killed via kill`, () => {
				const result = canTransition(state, "kill");
				expect(result).toEqual({ valid: true, from: state, to: "killed", event: "kill" });
			});

			it(`${state} transitions to archived via archive`, () => {
				const result = canTransition(state, "archive");
				expect(result).toEqual({ valid: true, from: state, to: "archived", event: "archive" });
			});
		}
	});

	describe("failed", () => {
		it("transitions to working via start (retry)", () => {
			const result = canTransition("failed", "start");
			expect(result).toEqual({ valid: true, from: "failed", to: "working", event: "start" });
		});

		it("transitions to killed via kill", () => {
			const result = canTransition("failed", "kill");
			expect(result).toEqual({ valid: true, from: "failed", to: "killed", event: "kill" });
		});

		it("transitions to archived via archive", () => {
			const result = canTransition("failed", "archive");
			expect(result).toEqual({ valid: true, from: "failed", to: "archived", event: "archive" });
		});
	});

	describe("killed", () => {
		it("transitions to archived via archive", () => {
			const result = canTransition("killed", "archive");
			expect(result).toEqual({ valid: true, from: "killed", to: "archived", event: "archive" });
		});
	});

	// ── Invalid transitions ───────────────────────────────────────────

	describe("invalid transitions", () => {
		it("rejects merge from spawning", () => {
			const result = canTransition("spawning", "merge");
			expect(result.valid).toBe(false);
			expect(result.reason).toBe("Cannot transition from 'spawning' via 'merge'");
		});

		it("rejects start from pr_open", () => {
			const result = canTransition("pr_open", "start");
			expect(result.valid).toBe(false);
			expect(result.reason).toContain("Cannot transition from 'pr_open' via 'start'");
		});

		it("rejects open_pr from merged", () => {
			const result = canTransition("merged", "open_pr");
			expect(result.valid).toBe(false);
		});

		it("rejects approve from working", () => {
			const result = canTransition("working", "approve");
			expect(result.valid).toBe(false);
			expect(result.reason).toContain("Cannot transition from 'working' via 'approve'");
		});

		it("uses archived as placeholder to for invalid transitions", () => {
			const result = canTransition("spawning", "merge");
			expect(result.to).toBe("archived");
		});

		it("includes the event in the result for invalid transitions", () => {
			const result = canTransition("spawning", "approve");
			expect(result.event).toBe("approve");
			expect(result.from).toBe("spawning");
		});
	});

	// ── Terminal state ────────────────────────────────────────────────

	describe("archived (terminal state)", () => {
		const allEvents: SessionEvent[] = [
			"start",
			"open_pr",
			"request_review",
			"ci_pass",
			"ci_fail",
			"approve",
			"request_changes",
			"conflict",
			"resolve",
			"make_mergeable",
			"merge",
			"kill",
			"archive",
			"fail",
		];

		it("rejects every event", () => {
			for (const event of allEvents) {
				const result = canTransition("archived", event);
				expect(result.valid).toBe(false);
			}
		});
	});
});

describe("validEvents", () => {
	it("returns start and kill for spawning", () => {
		const events = validEvents("spawning");
		expect(events).toEqual(expect.arrayContaining(["start", "kill"]));
		expect(events).toHaveLength(2);
	});

	it("returns open_pr, fail, kill for working", () => {
		const events = validEvents("working");
		expect(events).toEqual(expect.arrayContaining(["open_pr", "fail", "kill"]));
		expect(events).toHaveLength(3);
	});

	it("returns request_review, ci_fail, conflict, kill for pr_open", () => {
		const events = validEvents("pr_open");
		expect(events).toEqual(expect.arrayContaining(["request_review", "ci_fail", "conflict", "kill"]));
		expect(events).toHaveLength(4);
	});

	it("returns approve, request_changes, ci_fail, kill for review_pending", () => {
		const events = validEvents("review_pending");
		expect(events).toEqual(
			expect.arrayContaining(["approve", "request_changes", "ci_fail", "kill"]),
		);
		expect(events).toHaveLength(4);
	});

	it("returns ci_pass, make_mergeable, ci_fail, kill for approved", () => {
		const events = validEvents("approved");
		expect(events).toEqual(
			expect.arrayContaining(["ci_pass", "make_mergeable", "ci_fail", "kill"]),
		);
		expect(events).toHaveLength(4);
	});

	it("returns merge, conflict, kill for mergeable", () => {
		const events = validEvents("mergeable");
		expect(events).toEqual(expect.arrayContaining(["merge", "conflict", "kill"]));
		expect(events).toHaveLength(3);
	});

	it("returns archive for merged", () => {
		expect(validEvents("merged")).toEqual(["archive"]);
	});

	it("returns resolve, kill, archive for ci_failed", () => {
		const events = validEvents("ci_failed");
		expect(events).toEqual(expect.arrayContaining(["resolve", "kill", "archive"]));
		expect(events).toHaveLength(3);
	});

	it("returns resolve, kill, archive for changes_requested", () => {
		const events = validEvents("changes_requested");
		expect(events).toEqual(expect.arrayContaining(["resolve", "kill", "archive"]));
		expect(events).toHaveLength(3);
	});

	it("returns resolve, kill, archive for merge_conflicts", () => {
		const events = validEvents("merge_conflicts");
		expect(events).toEqual(expect.arrayContaining(["resolve", "kill", "archive"]));
		expect(events).toHaveLength(3);
	});

	it("returns start, kill, archive for failed", () => {
		const events = validEvents("failed");
		expect(events).toEqual(expect.arrayContaining(["start", "kill", "archive"]));
		expect(events).toHaveLength(3);
	});

	it("returns archive for killed", () => {
		expect(validEvents("killed")).toEqual(["archive"]);
	});

	it("returns empty array for archived (terminal state)", () => {
		expect(validEvents("archived")).toEqual([]);
	});
});

describe("SESSION_TRANSITIONS completeness", () => {
	const ALL_STATES: SessionStatus[] = [
		"spawning",
		"working",
		"pr_open",
		"review_pending",
		"ci_failed",
		"changes_requested",
		"merge_conflicts",
		"approved",
		"mergeable",
		"merged",
		"failed",
		"killed",
		"archived",
	];

	it("has an entry for every SessionStatus", () => {
		for (const state of ALL_STATES) {
			expect(SESSION_TRANSITIONS).toHaveProperty(state);
		}
	});

	it("all transition targets are valid SessionStatus values", () => {
		const stateSet = new Set(ALL_STATES);
		for (const [from, transitions] of Object.entries(SESSION_TRANSITIONS)) {
			for (const [event, to] of Object.entries(transitions)) {
				expect(stateSet.has(to as SessionStatus)).toBe(true);
			}
		}
	});
});
