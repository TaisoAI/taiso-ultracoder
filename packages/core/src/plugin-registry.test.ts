import { beforeEach, describe, expect, it, vi } from "vitest";
import { DefaultPluginRegistry } from "./plugin-registry.js";
import type { Logger, Plugin } from "./types.js";

function mockLogger(): Logger {
	return {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		child: vi.fn().mockReturnThis(),
	};
}

function mockPlugin(name: string, slot: "runtime" | "agent" = "runtime"): Plugin {
	return {
		meta: { name, slot, version: "0.0.1" },
	};
}

describe("DefaultPluginRegistry", () => {
	let registry: DefaultPluginRegistry;

	beforeEach(() => {
		registry = new DefaultPluginRegistry(mockLogger());
	});

	it("registers and retrieves a plugin", () => {
		const plugin = mockPlugin("test-runtime");
		registry.register(plugin);
		expect(registry.get("runtime")).toBe(plugin);
		expect(registry.has("runtime")).toBe(true);
	});

	it("returns undefined for unregistered slot", () => {
		expect(registry.get("runtime")).toBeUndefined();
		expect(registry.has("runtime")).toBe(false);
	});

	it("replaces existing plugin in same slot", () => {
		const p1 = mockPlugin("first");
		const p2 = mockPlugin("second");
		registry.register(p1);
		registry.register(p2);
		expect(registry.get("runtime")).toBe(p2);
	});

	it("throws for unknown slot", () => {
		const bad = { meta: { name: "bad", slot: "unknown" as any, version: "1" } };
		expect(() => registry.register(bad)).toThrow("Unknown plugin slot");
	});

	it("getAll returns all registered plugins", () => {
		registry.register(mockPlugin("rt", "runtime"));
		registry.register(mockPlugin("ag", "agent"));
		expect(registry.getAll().size).toBe(2);
	});

	it("initAll calls init and handles failures gracefully", async () => {
		const good = mockPlugin("good");
		(good as any).init = vi.fn().mockResolvedValue(undefined);

		const bad = mockPlugin("bad", "agent");
		(bad as any).init = vi.fn().mockRejectedValue(new Error("boom"));

		registry.register(good);
		registry.register(bad);

		await registry.initAll({} as any);

		expect((good as any).init).toHaveBeenCalled();
		// Bad plugin should be removed
		expect(registry.has("agent")).toBe(false);
		// Good plugin should remain
		expect(registry.has("runtime")).toBe(true);
	});
});
