import { execFileSync } from "node:child_process";
import { extname } from "node:path";
import type { AgentActivity, AgentCommandOpts, AgentPlugin } from "@ultracoder/core";
import { ClaudeStreamParser } from "./stream-parser.js";

/**
 * Resolve a bare command name to its full path on Windows.
 * On Windows, child_process.spawn() cannot find .cmd/.bat files
 * without an explicit extension or shell: true.
 */
function resolveCommand(name: string): string {
	if (process.platform !== "win32") return name;
	// If already has a path separator or extension, use as-is
	if (name.includes("/") || name.includes("\\") || extname(name)) return name;
	try {
		const result = execFileSync("where", [name], { encoding: "utf8", timeout: 5000 });
		const firstLine = result.trim().split(/\r?\n/)[0];
		if (firstLine) return firstLine;
	} catch {
		// Fall back to appending .cmd
	}
	return `${name}.cmd`;
}

export interface ClaudeCodeAgentConfig {
	claudePath?: string;
	model?: string;
}

export function create(config: ClaudeCodeAgentConfig = {}): AgentPlugin {
	const claudePath = resolveCommand(config.claudePath ?? "claude");
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
					// Only end_turn means successful completion;
					// max_tokens and other stop reasons indicate context exhaustion
					return {
						type: event.stopReason === "end_turn" ? "completed" : "error",
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
