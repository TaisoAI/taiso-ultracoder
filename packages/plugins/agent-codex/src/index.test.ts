import { describe, expect, it } from "vitest";
import { create } from "./index.js";

describe("agent-codex", () => {
	it("create() returns a valid plugin with correct meta", () => {
		const plugin = create();
		expect(plugin.meta.name).toBe("agent-codex");
		expect(plugin.meta.slot).toBe("agent");
		expect(plugin.meta.version).toBe("0.0.1");
	});

	it("buildCommand returns correct command structure", () => {
		const plugin = create();
		const result = plugin.buildCommand({
			task: "refactor module",
			workspacePath: "/tmp/workspace",
			config: {} as never,
		});
		expect(result.command).toBe("codex");
		expect(result.args).toContain("--task");
		expect(result.args).toContain("refactor module");
	});

	it("buildCommand uses custom codex path and model", () => {
		const plugin = create({ codexPath: "/opt/codex", model: "o3" });
		const result = plugin.buildCommand({
			task: "test",
			workspacePath: "/tmp",
			config: {} as never,
		});
		expect(result.command).toBe("/opt/codex");
		expect(result.args).toContain("--model");
		expect(result.args).toContain("o3");
	});

	it("parseActivity parses completed status", () => {
		const plugin = create();
		const activity = plugin.parseActivity(JSON.stringify({ type: "completed", message: "done" }));
		expect(activity).not.toBeNull();
		expect(activity?.type).toBe("completed");
	});

	it("parseActivity parses tool_call with tool field", () => {
		const plugin = create();
		const activity = plugin.parseActivity(JSON.stringify({ tool: "shell" }));
		expect(activity).not.toBeNull();
		expect(activity?.type).toBe("tool_call");
		expect(activity?.detail).toBe("shell");
	});

	it("parseActivity returns null for invalid JSON", () => {
		const plugin = create();
		expect(plugin.parseActivity("bad")).toBeNull();
	});
});
