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

			// Attach error listener immediately to prevent uncaught 'error' events
			// from crashing the host process (e.g. ENOENT when command not found).
			let spawnFailed = false;
			const spawnError = await new Promise<Error | null>((resolve) => {
				child.on("error", (err) => {
					if (!spawnFailed) {
						spawnFailed = true;
						resolve(err);
					}
					// After spawn, later errors (e.g. broken pipe) are non-fatal —
					// the process will emit 'exit' and be cleaned up normally.
				});
				// If pid is assigned synchronously, spawn succeeded
				if (child.pid !== undefined) {
					resolve(null);
				} else {
					// Give a tick for the error event to fire
					setImmediate(() => resolve(child.pid === undefined
						? new Error("Failed to spawn process: no pid assigned")
						: null));
				}
			});

			if (spawnError) {
				throw new Error(`Failed to spawn process: ${spawnError.message}`);
			}

			const pid = child.pid!;
			const id = String(pid);
			activeProcesses.set(id, child);

			const handle: RuntimeHandle = { id, pid };

			child.on("exit", (code, signal) => {
				activeProcesses.delete(id);
				if (opts.onExit) {
					opts.onExit(handle, code, signal);
				}
			});

			return handle;
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
