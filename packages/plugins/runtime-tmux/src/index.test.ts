import { describe, expect, it } from "vitest";
import { create } from "./index.js";

describe("runtime-tmux", () => {
	it("create() returns a valid plugin with correct meta", () => {
		const plugin = create();
		expect(plugin.meta.name).toBe("runtime-tmux");
		expect(plugin.meta.slot).toBe("runtime");
		expect(plugin.meta.version).toBe("0.0.1");
	});

	it("has all required RuntimePlugin methods", () => {
		const plugin = create();
		expect(typeof plugin.spawn).toBe("function");
		expect(typeof plugin.kill).toBe("function");
		expect(typeof plugin.isAlive).toBe("function");
		expect(typeof plugin.sendInput).toBe("function");
	});

	it("accepts custom tmuxPath config", () => {
		const plugin = create({ tmuxPath: "/usr/local/bin/tmux" });
		expect(plugin.meta.name).toBe("runtime-tmux");
	});
});
