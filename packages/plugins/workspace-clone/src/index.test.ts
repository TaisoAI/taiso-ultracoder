import { describe, expect, it } from "vitest";
import { create } from "./index.js";

describe("workspace-clone", () => {
	it("create() returns a valid plugin with correct meta", () => {
		const plugin = create();
		expect(plugin.meta.name).toBe("workspace-clone");
		expect(plugin.meta.slot).toBe("workspace");
		expect(plugin.meta.version).toBe("0.0.1");
	});

	it("has all required WorkspacePlugin methods", () => {
		const plugin = create();
		expect(typeof plugin.create).toBe("function");
		expect(typeof plugin.cleanup).toBe("function");
	});

	it("accepts depth config", () => {
		const plugin = create({ depth: 1 });
		expect(plugin.meta.name).toBe("workspace-clone");
	});
});
