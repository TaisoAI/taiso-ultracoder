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
});
