import type { AgentActivity, AgentCommandOpts, AgentPlugin } from "@ultracoder/core";
import { ClaudeStreamParser } from "./stream-parser.js";

export interface ClaudeCodeAgentConfig {
	claudePath?: string;
	model?: string;
}

export function create(config: ClaudeCodeAgentConfig = {}): AgentPlugin {
	const claudePath = config.claudePath ?? "claude";
	const parser = new ClaudeStreamParser();

	return {
		meta: {
			name: "agent-claude-code",
			slot: "agent",
			version: "0.0.1",
		},

		buildCommand(opts: AgentCommandOpts): { command: string; args: string[] } {
			const args = ["-p", opts.task, "--output-format", "stream-json"];

			if (config.model) {
				args.push("--model", config.model);
			}

			return { command: claudePath, args };
		},

		parseActivity(line: string): AgentActivity | null {
			const now = new Date().toISOString();
			const event = parser.parseLine(line);

			if (event === null) {
				return null;
			}

			switch (event.kind) {
				case "assistant_text":
					return {
						type: "active",
						timestamp: now,
						detail: event.text || undefined,
					};

				case "tool_use":
					return {
						type: "tool_call",
						timestamp: now,
						detail: event.toolName,
					};

				case "tool_result":
					if (event.isError) {
						return {
							type: "error",
							timestamp: now,
							detail: event.output || undefined,
						};
					}
					return {
						type: "active",
						timestamp: now,
						detail: event.output || undefined,
					};

				case "system":
					return {
						type: "completed",
						timestamp: now,
						detail: event.stopReason,
					};

				case "error":
					return {
						type: "error",
						timestamp: now,
						detail: event.message,
					};

				case "unknown":
					return {
						type: "active",
						timestamp: now,
					};
			}
		},
	};
}

export { ClaudeStreamParser } from "./stream-parser.js";
export default create;
