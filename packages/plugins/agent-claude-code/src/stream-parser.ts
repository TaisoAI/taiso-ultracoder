/**
 * ClaudeStreamParser — versioned parser for Claude Code `--output-format stream-json` output.
 *
 * Parses newline-delimited JSON into typed ClaudeStreamEvent objects.
 * Schema-tolerant: unknown fields are silently ignored, missing optional fields
 * do not crash, and malformed lines return null instead of throwing.
 */

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export interface AssistantTextEvent {
	kind: "assistant_text";
	text: string;
}

export interface ToolUseEvent {
	kind: "tool_use";
	toolName: string;
	toolUseId?: string;
	input: Record<string, unknown>;
}

export interface ToolResultEvent {
	kind: "tool_result";
	toolUseId?: string;
	output: string;
	isError: boolean;
}

export interface SystemEvent {
	kind: "system";
	stopReason?: string;
	usage?: {
		inputTokens?: number;
		outputTokens?: number;
	};
}

export interface ErrorEvent {
	kind: "error";
	message: string;
}

export interface UnknownEvent {
	kind: "unknown";
	rawType?: string;
}

export type ClaudeStreamEvent =
	| AssistantTextEvent
	| ToolUseEvent
	| ToolResultEvent
	| SystemEvent
	| ErrorEvent
	| UnknownEvent;

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export class ClaudeStreamParser {
	readonly version = "v1" as const;

	/**
	 * Parse a single line of Claude Code stream-json output.
	 * Returns null if the line is not valid JSON or cannot be interpreted.
	 */
	parseLine(line: string): ClaudeStreamEvent | null {
		const trimmed = line.trim();
		if (trimmed === "") return null;

		let data: Record<string, unknown>;
		try {
			data = JSON.parse(trimmed) as Record<string, unknown>;
		} catch {
			return null;
		}

		if (typeof data !== "object" || data === null || Array.isArray(data)) return null;

		try {
			return this.interpret(data);
		} catch {
			return null;
		}
	}

	// -----------------------------------------------------------------------
	// Private helpers
	// -----------------------------------------------------------------------

	private interpret(data: Record<string, unknown>): ClaudeStreamEvent | null {
		const type = data.type;

		if (type === "assistant") {
			return this.parseAssistant(data);
		}

		if (type === "tool") {
			return this.parseToolResult(data);
		}

		if (type === "result") {
			return this.parseResult(data);
		}

		if (type === "error") {
			return this.parseError(data);
		}

		// Unrecognised top-level type
		if (typeof type === "string") {
			return { kind: "unknown", rawType: type };
		}

		return null;
	}

	/**
	 * Handle `{"type":"assistant","message":{"role":"assistant","content":[...]}}`
	 *
	 * Content blocks can be text or tool_use. We emit the *first* meaningful
	 * block we find — callers receive one event per line, which matches the
	 * Claude Code stream-json contract of one JSON object per line.
	 */
	private parseAssistant(data: Record<string, unknown>): ClaudeStreamEvent | null {
		const message = data.message as Record<string, unknown> | undefined;
		const contentBlocks = (message?.content ?? []) as unknown[];

		for (const block of contentBlocks) {
			if (typeof block !== "object" || block === null) continue;
			const b = block as Record<string, unknown>;

			if (b.type === "text" && typeof b.text === "string") {
				return { kind: "assistant_text", text: b.text };
			}

			if (b.type === "tool_use") {
				const toolName = typeof b.name === "string" ? b.name : "unknown";
				const toolUseId = typeof b.id === "string" ? b.id : undefined;
				const input =
					typeof b.input === "object" && b.input !== null
						? (b.input as Record<string, unknown>)
						: {};
				return { kind: "tool_use", toolName, toolUseId, input };
			}
		}

		// Assistant message with no parseable content blocks
		return { kind: "assistant_text", text: "" };
	}

	/**
	 * Handle `{"type":"tool","content":[{"type":"tool_result",...}]}`
	 */
	private parseToolResult(data: Record<string, unknown>): ClaudeStreamEvent | null {
		const contentBlocks = (data.content ?? []) as unknown[];

		for (const block of contentBlocks) {
			if (typeof block !== "object" || block === null) continue;
			const b = block as Record<string, unknown>;

			if (b.type === "tool_result") {
				const toolUseId = typeof b.tool_use_id === "string" ? b.tool_use_id : undefined;
				const output = typeof b.content === "string" ? b.content : "";
				const isError = b.is_error === true;
				return { kind: "tool_result", toolUseId, output, isError };
			}
		}

		return { kind: "unknown", rawType: "tool" };
	}

	/**
	 * Handle `{"type":"result","message":{...,"stop_reason":"end_turn","usage":{...}}}`
	 */
	private parseResult(data: Record<string, unknown>): SystemEvent {
		const message = data.message as Record<string, unknown> | undefined;
		const stopReason = typeof message?.stop_reason === "string" ? message.stop_reason : undefined;

		let usage: SystemEvent["usage"] | undefined;
		const rawUsage = message?.usage as Record<string, unknown> | undefined;
		if (rawUsage) {
			usage = {
				inputTokens: typeof rawUsage.input_tokens === "number" ? rawUsage.input_tokens : undefined,
				outputTokens:
					typeof rawUsage.output_tokens === "number" ? rawUsage.output_tokens : undefined,
			};
		}

		return { kind: "system", stopReason, usage };
	}

	/**
	 * Handle `{"type":"error","error":{"message":"..."}}`  or  `{"type":"error","error":"..."}`
	 */
	private parseError(data: Record<string, unknown>): ErrorEvent {
		const err = data.error;
		let message = "unknown error";
		if (typeof err === "string") {
			message = err;
		} else if (typeof err === "object" && err !== null) {
			const errObj = err as Record<string, unknown>;
			if (typeof errObj.message === "string") {
				message = errObj.message;
			}
		}
		return { kind: "error", message };
	}
}
