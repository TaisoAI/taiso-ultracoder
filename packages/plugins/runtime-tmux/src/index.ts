import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { RuntimeHandle, RuntimePlugin, RuntimeSpawnOpts } from "@ultracoder/core";

export interface TmuxRuntimeConfig {
	tmuxPath?: string;
}

function exec(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		execFile(cmd, args, (error, stdout, stderr) => {
			if (error) {
				reject(error);
				return;
			}
			resolve({ stdout, stderr });
		});
	});
}

/** Quote a string for safe shell interpolation. */
function shellQuote(s: string): string {
	if (/^[a-zA-Z0-9._\-/=:@]+$/.test(s)) return s;
	return `'${s.replace(/'/g, "'\\''")}'`;
}

export function create(config: TmuxRuntimeConfig = {}): RuntimePlugin {
	const tmux = config.tmuxPath ?? "tmux";

	return {
		meta: {
			name: "runtime-tmux",
			slot: "runtime",
			version: "0.0.1",
		},

		async spawn(opts: RuntimeSpawnOpts): Promise<RuntimeHandle> {
			const name = opts.name ?? `uc-${randomUUID().slice(0, 8)}`;
			const fullCommand = [opts.command, ...opts.args].map(shellQuote).join(" ");
			await exec(tmux, ["new-session", "-d", "-s", name, fullCommand]);
			return { id: name };
		},

		async kill(handle: RuntimeHandle): Promise<void> {
			await exec(tmux, ["kill-session", "-t", handle.id]);
		},

		async isAlive(handle: RuntimeHandle): Promise<boolean> {
			try {
				await exec(tmux, ["has-session", "-t", handle.id]);
				return true;
			} catch {
				return false;
			}
		},

		async sendInput(handle: RuntimeHandle, input: string): Promise<void> {
			await exec(tmux, ["send-keys", "-t", handle.id, input, "Enter"]);
		},
	};
}

export default create;
