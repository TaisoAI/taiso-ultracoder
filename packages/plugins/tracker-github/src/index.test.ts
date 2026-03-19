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
});
