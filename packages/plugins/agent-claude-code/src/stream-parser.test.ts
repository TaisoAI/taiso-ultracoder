import { describe, expect, it } from "vitest";
import { ClaudeStreamParser } from "./stream-parser.js";
import type {
	AssistantTextEvent,
	ErrorEvent,
	SystemEvent,
	ToolResultEvent,
	ToolUseEvent,
	UnknownEvent,
} from "./stream-parser.js";

// ---------------------------------------------------------------------------
// Fixtures — representative Claude Code stream-json lines
// ---------------------------------------------------------------------------

const fixtures = {
	assistantText: JSON.stringify({
		type: "assistant",
		message: {
			role: "assistant",
			content: [{ type: "text", text: "Let me read the file." }],
		},
	}),

	toolUse: JSON.stringify({
		type: "assistant",
		message: {
			role: "assistant",
			content: [
				{
					type: "tool_use",
					id: "toolu_abc123",
					name: "Read",
					input: { file_path: "/tmp/test.ts" },
				},
			],
		},
	}),

	toolResult: JSON.stringify({
		type: "tool",
		content: [
			{
				type: "tool_result",
				tool_use_id: "toolu_abc123",
				content: "file contents here",
			},
		],
	}),

	toolResultError: JSON.stringify({
		type: "tool",
		content: [
			{
				type: "tool_result",
				tool_use_id: "toolu_abc123",
				content: "file not found",
				is_error: true,
			},
		],
	}),

	result: JSON.stringify({
		type: "result",
		message: {
			role: "assistant",
			stop_reason: "end_turn",
			usage: { input_tokens: 1000, output_tokens: 500 },
		},
	}),

	error: JSON.stringify({
		type: "error",
		error: { message: "context window exceeded" },
	}),

	errorString: JSON.stringify({
		type: "error",
		error: "something broke",
	}),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ClaudeStreamParser", () => {
	const parser = new ClaudeStreamParser();

	it("has version v1", () => {
		expect(parser.version).toBe("v1");
	});

	// -- assistant_text ---------------------------------------------------

	describe("assistant_text events", () => {
		it("parses assistant text content", () => {
			const event = parser.parseLine(fixtures.assistantText) as AssistantTextEvent;
			expect(event).not.toBeNull();
			expect(event.kind).toBe("assistant_text");
			expect(event.text).toBe("Let me read the file.");
		});

		it("returns empty text for assistant with no content blocks", () => {
			const line = JSON.stringify({ type: "assistant", message: { content: [] } });
			const event = parser.parseLine(line) as AssistantTextEvent;
			expect(event.kind).toBe("assistant_text");
			expect(event.text).toBe("");
		});
	});

	// -- tool_use ---------------------------------------------------------

	describe("tool_use events", () => {
		it("parses tool_use with name and input", () => {
			const event = parser.parseLine(fixtures.toolUse) as ToolUseEvent;
			expect(event).not.toBeNull();
			expect(event.kind).toBe("tool_use");
			expect(event.toolName).toBe("Read");
			expect(event.toolUseId).toBe("toolu_abc123");
			expect(event.input).toEqual({ file_path: "/tmp/test.ts" });
		});

		it("handles tool_use with missing input gracefully", () => {
			const line = JSON.stringify({
				type: "assistant",
				message: {
					content: [{ type: "tool_use", id: "toolu_x", name: "Bash" }],
				},
			});
			const event = parser.parseLine(line) as ToolUseEvent;
			expect(event.kind).toBe("tool_use");
			expect(event.toolName).toBe("Bash");
			expect(event.input).toEqual({});
		});

		it("handles tool_use with missing name", () => {
			const line = JSON.stringify({
				type: "assistant",
				message: { content: [{ type: "tool_use" }] },
			});
			const event = parser.parseLine(line) as ToolUseEvent;
			expect(event.kind).toBe("tool_use");
			expect(event.toolName).toBe("unknown");
		});
	});

	// -- tool_result ------------------------------------------------------

	describe("tool_result events", () => {
		it("parses successful tool result", () => {
			const event = parser.parseLine(fixtures.toolResult) as ToolResultEvent;
			expect(event.kind).toBe("tool_result");
			expect(event.toolUseId).toBe("toolu_abc123");
			expect(event.output).toBe("file contents here");
			expect(event.isError).toBe(false);
		});

		it("parses error tool result", () => {
			const event = parser.parseLine(fixtures.toolResultError) as ToolResultEvent;
			expect(event.kind).toBe("tool_result");
			expect(event.isError).toBe(true);
			expect(event.output).toBe("file not found");
		});
	});

	// -- system (result) --------------------------------------------------

	describe("system events", () => {
		it("parses result with usage information", () => {
			const event = parser.parseLine(fixtures.result) as SystemEvent;
			expect(event.kind).toBe("system");
			expect(event.stopReason).toBe("end_turn");
			expect(event.usage?.inputTokens).toBe(1000);
			expect(event.usage?.outputTokens).toBe(500);
		});

		it("parses result without usage", () => {
			const line = JSON.stringify({ type: "result", message: { stop_reason: "max_tokens" } });
			const event = parser.parseLine(line) as SystemEvent;
			expect(event.kind).toBe("system");
			expect(event.stopReason).toBe("max_tokens");
			expect(event.usage).toBeUndefined();
		});
	});

	// -- error ------------------------------------------------------------

	describe("error events", () => {
		it("parses error with object payload", () => {
			const event = parser.parseLine(fixtures.error) as ErrorEvent;
			expect(event.kind).toBe("error");
			expect(event.message).toBe("context window exceeded");
		});

		it("parses error with string payload", () => {
			const event = parser.parseLine(fixtures.errorString) as ErrorEvent;
			expect(event.kind).toBe("error");
			expect(event.message).toBe("something broke");
		});
	});

	// -- unknown ----------------------------------------------------------

	describe("unknown events", () => {
		it("returns unknown for unrecognised types", () => {
			const line = JSON.stringify({ type: "ping" });
			const event = parser.parseLine(line) as UnknownEvent;
			expect(event.kind).toBe("unknown");
			expect(event.rawType).toBe("ping");
		});
	});

	// -- malformed / edge cases -------------------------------------------

	describe("malformed and edge-case inputs", () => {
		it("returns null for empty string", () => {
			expect(parser.parseLine("")).toBeNull();
		});

		it("returns null for whitespace-only string", () => {
			expect(parser.parseLine("   ")).toBeNull();
		});

		it("returns null for invalid JSON", () => {
			expect(parser.parseLine("not json at all")).toBeNull();
		});

		it("returns null for JSON array", () => {
			expect(parser.parseLine("[1,2,3]")).toBeNull();
		});

		it("returns null for JSON primitive", () => {
			expect(parser.parseLine('"just a string"')).toBeNull();
		});

		it("returns null for object without type field", () => {
			expect(parser.parseLine(JSON.stringify({ foo: "bar" }))).toBeNull();
		});
	});

	// -- schema tolerance -------------------------------------------------

	describe("schema tolerance", () => {
		it("ignores unknown fields in assistant message", () => {
			const line = JSON.stringify({
				type: "assistant",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "hello" }],
					extra_field: true,
				},
				unknown_top_level: 42,
			});
			const event = parser.parseLine(line) as AssistantTextEvent;
			expect(event.kind).toBe("assistant_text");
			expect(event.text).toBe("hello");
		});

		it("ignores unknown fields in tool_use input", () => {
			const line = JSON.stringify({
				type: "assistant",
				message: {
					content: [
						{
							type: "tool_use",
							id: "toolu_1",
							name: "Edit",
							input: { file_path: "/a.ts", old_string: "x", new_string: "y" },
							extra: "ignored",
						},
					],
				},
			});
			const event = parser.parseLine(line) as ToolUseEvent;
			expect(event.kind).toBe("tool_use");
			expect(event.toolName).toBe("Edit");
			expect(event.input).toHaveProperty("file_path");
		});
	});
});
