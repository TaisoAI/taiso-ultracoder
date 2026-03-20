import { describe, expect, it } from "vitest";
import { create } from "./index.js";

describe("tracker-github", () => {
	it("create() returns a valid plugin with correct meta", () => {
		const plugin = create();
		expect(plugin.meta.name).toBe("tracker-github");
		expect(plugin.meta.slot).toBe("tracker");
		expect(plugin.meta.version).toBe("0.0.1");
	});

	it("has all required TrackerPlugin methods", () => {
		const plugin = create();
		expect(typeof plugin.createIssue).toBe("function");
		expect(typeof plugin.updateIssue).toBe("function");
		expect(typeof plugin.getIssue).toBe("function");
	});

	it("accepts repo config", () => {
		const plugin = create({ repo: "owner/repo" });
		expect(plugin.meta.name).toBe("tracker-github");
	});

	describe("validateId", () => {
		const tracker = create({ ghPath: "/bin/false" });

		const invalidIds = [
			"--repo=evil/repo",
			"abc",
			"12a",
			"",
			" 42",
			"42 ",
			"-1",
			"1.5",
			"1\n2",
		];

		describe("updateIssue rejects invalid IDs", () => {
			for (const id of invalidIds) {
				it(`rejects "${id}"`, async () => {
					await expect(tracker.updateIssue(id, { title: "x" })).rejects.toThrow(
						"must be a numeric string",
					);
				});
			}
		});

		describe("addComment rejects invalid IDs", () => {
			for (const id of invalidIds) {
				it(`rejects "${id}"`, async () => {
					await expect(tracker.addComment!(id, "body")).rejects.toThrow(
						"must be a numeric string",
					);
				});
			}
		});

		describe("getIssue rejects invalid IDs", () => {
			for (const id of invalidIds) {
				it(`rejects "${id}"`, async () => {
					await expect(tracker.getIssue(id)).rejects.toThrow("must be a numeric string");
				});
			}
		});

		describe("valid numeric IDs pass validation", () => {
			for (const id of ["1", "42", "99999"]) {
				it(`accepts "${id}" (fails at exec, not validation)`, async () => {
					const err = await tracker.getIssue(id).catch((e: Error) => e);
					expect(err).toBeInstanceOf(Error);
					expect((err as Error).message).not.toContain("must be a numeric string");
				});
			}
		});
	});
});
