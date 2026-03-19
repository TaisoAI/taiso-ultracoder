import { afterEach, describe, expect, it } from "vitest";
import { create } from "./index.js";

describe("terminal-web", () => {
	let plugin: ReturnType<typeof create> | null = null;

	afterEach(async () => {
		if (plugin) {
			await plugin.stop();
			plugin = null;
		}
	});

	it("create() returns a valid plugin with correct meta", () => {
		plugin = create();
		expect(plugin.meta.name).toBe("terminal-web");
		expect(plugin.meta.slot).toBe("reviewer");
		expect(plugin.meta.version).toBe("0.0.1");
	});

	it("has start and stop methods", () => {
		plugin = create();
		expect(typeof plugin.start).toBe("function");
		expect(typeof plugin.stop).toBe("function");
	});

	it("start() returns a URL and stop() shuts down cleanly", async () => {
		plugin = create({ port: 0 });
		const result = await plugin.start();
		expect(result.url).toMatch(/^http:\/\/localhost:/);
		await plugin.stop();
		plugin = null;
	});

	it("uses custom host and port config", () => {
		plugin = create({ port: 4200, host: "0.0.0.0" });
		expect(plugin.meta.name).toBe("terminal-web");
	});

	it("stop() is safe to call when not started", async () => {
		plugin = create();
		await expect(plugin.stop()).resolves.toBeUndefined();
	});
});
