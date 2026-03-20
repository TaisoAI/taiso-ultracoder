import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { IssueStore } from "./issue-store.js";
import type { IssueRecord } from "./types.js";

function makeRecord(overrides: Partial<IssueRecord> = {}): IssueRecord {
	return {
		issueId: "42",
		issueUrl: "https://github.com/test/repo/issues/42",
		title: "Test issue",
		body: "Something is broken",
		state: "seen",
		firstSeenAt: new Date().toISOString(),
		lastCheckedAt: new Date().toISOString(),
		...overrides,
	};
}

describe("IssueStore", () => {
	let tmpDir: string;
	let store: IssueStore;

	beforeEach(async () => {
		tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "issue-store-"));
		store = new IssueStore(tmpDir);
		await store.init();
	});

	afterEach(async () => {
		await fs.promises.rm(tmpDir, { recursive: true, force: true });
	});

	it("stores and retrieves records", async () => {
		const record = makeRecord();
		await store.set(record);

		const retrieved = await store.get("42");
		expect(retrieved).toBeDefined();
		expect(retrieved!.issueId).toBe("42");
		expect(retrieved!.title).toBe("Test issue");
	});

	it("returns undefined for missing records", async () => {
		const result = await store.get("999");
		expect(result).toBeUndefined();
	});

	it("checks existence with has()", async () => {
		expect(await store.has("42")).toBe(false);
		await store.set(makeRecord());
		expect(await store.has("42")).toBe(true);
	});

	it("lists all records", async () => {
		await store.set(makeRecord({ issueId: "1" }));
		await store.set(makeRecord({ issueId: "2" }));
		await store.set(makeRecord({ issueId: "3" }));

		const all = await store.all();
		expect(all).toHaveLength(3);
	});

	describe("state transitions", () => {
		it("allows valid transitions: seen → assessing", async () => {
			await store.set(makeRecord());
			const updated = await store.transition("42", "assessing");
			expect(updated.state).toBe("assessing");
		});

		it("allows valid transitions: assessing → assessed", async () => {
			await store.set(makeRecord({ state: "assessing" }));
			const updated = await store.transition("42", "assessed");
			expect(updated.state).toBe("assessed");
		});

		it("allows valid transitions: assessed → planning", async () => {
			await store.set(makeRecord({ state: "assessed" }));
			const updated = await store.transition("42", "planning");
			expect(updated.state).toBe("planning");
		});

		it("allows valid transitions: planning → spawning", async () => {
			await store.set(makeRecord({ state: "planning" }));
			const updated = await store.transition("42", "spawning");
			expect(updated.state).toBe("spawning");
		});

		it("allows valid transitions: spawning → spawned", async () => {
			await store.set(makeRecord({ state: "spawning" }));
			const updated = await store.transition("42", "spawned");
			expect(updated.state).toBe("spawned");
		});

		it("rejects invalid transitions", async () => {
			await store.set(makeRecord({ state: "seen" }));
			await expect(store.transition("42", "spawned")).rejects.toThrow(
				"Invalid transition: seen → spawned",
			);
		});

		it("rejects transitions from terminal states", async () => {
			await store.set(makeRecord({ state: "spawned" }));
			await expect(store.transition("42", "seen")).rejects.toThrow(
				"Invalid transition",
			);
		});

		it("allows error recovery: error → seen", async () => {
			await store.set(makeRecord({ state: "error" }));
			const updated = await store.transition("42", "seen");
			expect(updated.state).toBe("seen");
		});

		it("throws for missing record", async () => {
			await expect(store.transition("999", "assessing")).rejects.toThrow(
				"Issue 999 not found",
			);
		});
	});

	describe("update", () => {
		it("merges fields without state validation", async () => {
			await store.set(makeRecord());
			const updated = await store.update("42", {
				assessments: {
					claude: {
						agent: "claude-opus-4-6",
						severity: "high",
						effort: "small",
						rootCause: "Missing null check",
						proposedFix: "Add guard",
						relatedFiles: ["src/foo.ts"],
						confidence: 0.9,
						completedAt: new Date().toISOString(),
					},
				},
			});
			expect(updated.assessments?.claude?.severity).toBe("high");
		});

		it("throws for missing record", async () => {
			await expect(store.update("999", { title: "new" })).rejects.toThrow(
				"Issue 999 not found",
			);
		});
	});

	describe("recoverStale", () => {
		it("recovers records stuck in assessing", async () => {
			const old = new Date(Date.now() - 600_000).toISOString();
			await store.set(makeRecord({ state: "assessing", lastCheckedAt: old }));

			const recovered = await store.recoverStale(300_000);
			expect(recovered).toEqual(["42"]);

			const record = await store.get("42");
			expect(record!.state).toBe("seen");
		});

		it("does not recover recent records", async () => {
			await store.set(makeRecord({ state: "assessing" }));
			const recovered = await store.recoverStale(300_000);
			expect(recovered).toEqual([]);
		});

		it("ignores non-assessing records", async () => {
			const old = new Date(Date.now() - 600_000).toISOString();
			await store.set(makeRecord({ state: "planning", lastCheckedAt: old }));

			const recovered = await store.recoverStale(300_000);
			expect(recovered).toEqual([]);
		});
	});
});
