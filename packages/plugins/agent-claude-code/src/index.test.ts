import { describe, expect, it } from "vitest";
import { create } from "./index.js";

describe("agent-claude-code", () => {
	it("create() returns a valid plugin with correct meta", () => {
		const plugin = create();
		expect(plugin.meta.name).toBe("agent-claude-code");
		expect(plugin.meta.slot).toBe("agent");
		expect(plugin.meta.version).toBe("0.0.1");
	});

	it("buildCommand returns correct command structure", () => {
		const plugin = create();
		const result = plugin.buildCommand({
			task: "fix the bug",
			workspacePath: "/tmp/workspace",
			config: {} as never,
		});
		expect(result.command).toBe("claude");
		expect(result.args).toContain("-p");
		expect(result.args).toContain("fix the bug");
		expect(result.args).toContain("--output-format");
		expect(result.args).toContain("stream-json");
	});

	it("buildCommand uses custom claude path", () => {
		const plugin = create({ claudePath: "/opt/claude" });
		const result = plugin.buildCommand({
			task: "test",
			workspacePath: "/tmp",
			config: {} as never,
		});
		expect(result.command).toBe("/opt/claude");
	});

	it("parseActivity parses result type as completed", () => {
		const plugin = create();
		const activity = plugin.parseActivity(
			JSON.stringify({
				type: "result",
				message: { stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 50 } },
			}),
		);
		expect(activity).not.toBeNull();
		expect(activity?.type).toBe("completed");
		expect(activity?.detail).toBe("end_turn");
	});

	it("parseActivity parses tool_use type as tool_call", () => {
		const plugin = create();
		const activity = plugin.parseActivity(
			JSON.stringify({
				type: "assistant",
				message: {
					content: [
						{ type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "/tmp/a.ts" } },
					],
				},
			}),
		);
		expect(activity).not.toBeNull();
		expect(activity?.type).toBe("tool_call");
		expect(activity?.detail).toBe("Read");
	});

	it("parseActivity parses error type", () => {
		const plugin = create();
		const activity = plugin.parseActivity(
			JSON.stringify({ type: "error", error: "something broke" }),
		);
		expect(activity).not.toBeNull();
		expect(activity?.type).toBe("error");
		expect(activity?.detail).toBe("something broke");
	});

	it("parseActivity parses assistant text as active", () => {
		const plugin = create();
		const activity = plugin.parseActivity(
			JSON.stringify({
				type: "assistant",
				message: { content: [{ type: "text", text: "Thinking..." }] },
			}),
		);
		expect(activity).not.toBeNull();
		expect(activity?.type).toBe("active");
		expect(activity?.detail).toBe("Thinking...");
	});

	it("parseActivity maps error tool_result to error activity", () => {
		const plugin = create();
		const activity = plugin.parseActivity(
			JSON.stringify({
				type: "tool",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_1",
						content: "permission denied",
						is_error: true,
					},
				],
			}),
		);
		expect(activity).not.toBeNull();
		expect(activity?.type).toBe("error");
		expect(activity?.detail).toBe("permission denied");
	});

	it("parseActivity returns null for invalid JSON", () => {
		const plugin = create();
		const activity = plugin.parseActivity("not json");
		expect(activity).toBeNull();
	});

	it("parseActivity returns active for unknown event type", () => {
		const plugin = create();
		const activity = plugin.parseActivity(JSON.stringify({ type: "unknown_event" }));
		expect(activity).not.toBeNull();
		expect(activity?.type).toBe("active");
	});
});
