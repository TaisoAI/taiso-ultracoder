import { execFileSync } from "node:child_process";
import { extname } from "node:path";
import type { AgentActivity, AgentCommandOpts, AgentPlugin } from "@ultracoder/core";

/**
 * Resolve a bare command name to its full path on Windows.
 */
function resolveCommand(name: string): string {
	if (process.platform !== "win32") return name;
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

export interface CodexAgentConfig {
	codexPath?: string;
	model?: string;
}

export function create(config: CodexAgentConfig = {}): AgentPlugin {
	const codexPath = resolveCommand(config.codexPath ?? "codex");

	return {
		meta: {
			name: "agent-codex",
			slot: "agent",
			version: "0.0.1",
		},

		buildCommand(opts: AgentCommandOpts): { command: string; args: string[] } {
			const args = ["--task", opts.task];

			if (config.model) {
				args.push("--model", config.model);
			}

			return { command: codexPath, args };
		},

		parseActivity(line: string): AgentActivity | null {
			try {
				const data = JSON.parse(line) as Record<string, unknown>;
				const now = new Date().toISOString();

				if (data.type === "completed" || data.status === "completed") {
					return {
						type: "completed",
						timestamp: now,
						detail: typeof data.message === "string" ? data.message : undefined,
					};
				}

				if (data.type === "error" || data.status === "error") {
					return {
						type: "error",
						timestamp: now,
						detail: typeof data.message === "string" ? data.message : undefined,
					};
				}

				if (data.type === "tool_call" || data.tool !== undefined) {
					return {
						type: "tool_call",
						timestamp: now,
						detail: typeof data.tool === "string" ? data.tool : undefined,
					};
				}

				if (data.type === "message" || data.type === "thinking") {
					return {
						type: "active",
						timestamp: now,
					};
				}

				return null;
			} catch {
				return null;
			}
		},
	};
}

export default create;
