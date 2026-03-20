import { describe, expect, it } from "vitest";
import { create } from "./index.js";

describe("scm-github", () => {
	it("create() returns a valid plugin with correct meta", () => {
		const plugin = create();
		expect(plugin.meta.name).toBe("scm-github");
		expect(plugin.meta.slot).toBe("scm");
		expect(plugin.meta.version).toBe("0.0.1");
	});

	it("has all required ScmPlugin methods", () => {
		const plugin = create();
		expect(typeof plugin.createPR).toBe("function");
		expect(typeof plugin.getPRStatus).toBe("function");
		expect(typeof plugin.mergePR).toBe("function");
		expect(typeof plugin.getCIStatus).toBe("function");
	});

	it("accepts repo config", () => {
		const plugin = create({ repo: "owner/repo" });
		expect(plugin.meta.name).toBe("scm-github");
	});

	describe("validateId", () => {
		const scm = create({ ghPath: "/bin/false" });

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

		describe("getPRStatus rejects invalid IDs", () => {
			for (const id of invalidIds) {
				it(`rejects "${id}"`, async () => {
					await expect(scm.getPRStatus(id)).rejects.toThrow("must be a numeric string");
				});
			}
		});

		describe("mergePR rejects invalid IDs", () => {
			for (const id of invalidIds) {
				it(`rejects "${id}"`, async () => {
					await expect(scm.mergePR(id)).rejects.toThrow("must be a numeric string");
				});
			}
		});

		describe("valid numeric IDs pass validation", () => {
			for (const id of ["1", "42", "99999"]) {
				it(`accepts "${id}" (fails at exec, not validation)`, async () => {
					const err = await scm.getPRStatus(id).catch((e: Error) => e);
					expect(err).toBeInstanceOf(Error);
					expect((err as Error).message).not.toContain("must be a numeric string");
				});
			}
		});
	});
});
