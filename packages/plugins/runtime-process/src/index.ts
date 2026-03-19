import { spawn as cpSpawn } from "node:child_process";
import type { RuntimeHandle, RuntimePlugin, RuntimeSpawnOpts } from "@ultracoder/core";

export interface ProcessRuntimeConfig {
	killTimeout?: number;
}

const activeProcesses = new Map<string, ReturnType<typeof cpSpawn>>();

export function create(config: ProcessRuntimeConfig = {}): RuntimePlugin {
	const killTimeout = config.killTimeout ?? 5000;

	return {
		meta: {
			name: "runtime-process",
			slot: "runtime",
			version: "0.0.1",
		},

		async spawn(opts: RuntimeSpawnOpts): Promise<RuntimeHandle> {
			const child = cpSpawn(opts.command, opts.args, {
				cwd: opts.cwd,
				env: opts.env ? { ...process.env, ...opts.env } : undefined,
				stdio: ["pipe", "pipe", "pipe"],
			});

			const pid = child.pid;
			if (pid === undefined) {
				throw new Error("Failed to spawn process: no pid assigned");
			}

			const id = String(pid);
			activeProcesses.set(id, child);

			child.on("exit", () => {
				activeProcesses.delete(id);
			});

			return { id, pid };
		},

		async kill(handle: RuntimeHandle): Promise<void> {
			const child = activeProcesses.get(handle.id);
			if (child) {
				child.kill("SIGTERM");
				await new Promise<void>((resolve) => {
					const timer = setTimeout(() => {
						child.kill("SIGKILL");
						resolve();
					}, killTimeout);
					child.on("exit", () => {
						clearTimeout(timer);
						resolve();
					});
				});
				activeProcesses.delete(handle.id);
				return;
			}

			// Fallback: kill by pid directly
			if (handle.pid) {
				try {
					process.kill(handle.pid, "SIGTERM");
					await new Promise<void>((resolve) => {
						const timer = setTimeout(() => {
							try {
								process.kill(handle.pid!, "SIGKILL");
							} catch {
								// already dead
							}
							resolve();
						}, killTimeout);
						const check = setInterval(() => {
							try {
								process.kill(handle.pid!, 0);
							} catch {
								clearInterval(check);
								clearTimeout(timer);
								resolve();
							}
						}, 100);
					});
				} catch {
					// process already dead
				}
			}
		},

		async isAlive(handle: RuntimeHandle): Promise<boolean> {
			const child = activeProcesses.get(handle.id);
			if (child && !child.killed) {
				return true;
			}
			if (handle.pid) {
				try {
					process.kill(handle.pid, 0);
					return true;
				} catch {
					return false;
				}
			}
			return false;
		},

		async sendInput(handle: RuntimeHandle, input: string): Promise<void> {
			const child = activeProcesses.get(handle.id);
			if (!child?.stdin) {
				throw new Error(`No stdin available for process ${handle.id}`);
			}
			child.stdin.write(`${input}\n`);
		},
	};
}

export default create;
