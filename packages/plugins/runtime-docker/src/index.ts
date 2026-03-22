import Docker from "dockerode";
import type {
	RuntimeHandle,
	RuntimePlugin,
	RuntimeSpawnOpts,
} from "@ultracoder/core";

export interface DockerRuntimeConfig {
	image?: string;
	network?: "none" | "bridge" | string;
	memoryMb?: number;
	cpus?: number;
	workspaceMountPath?: string;
	extraBinds?: string[];
	env?: Record<string, string>;
	stopTimeoutSeconds?: number;
	/** Run container as this user (e.g., "1000:1000"). Defaults to "1000:1000" on Linux. */
	user?: string;
}

export function create(config: DockerRuntimeConfig = {}): RuntimePlugin {
	const image = config.image ?? "node:22-slim";
	const network = config.network ?? "none";
	const memoryMb = config.memoryMb ?? 2048;
	const cpus = config.cpus ?? 2;
	const workspaceMountPath = config.workspaceMountPath ?? "/workspace";
	const extraBinds = config.extraBinds ?? [];
	const configEnv = config.env ?? {};
	const stopTimeoutSeconds = config.stopTimeoutSeconds ?? 10;
	// Default to non-root user on Linux to avoid root-owned files in workspace
	const user = config.user ?? (process.platform === "linux" ? `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}` : undefined);

	const docker = new Docker();

	return {
		meta: {
			name: "runtime-docker",
			slot: "runtime",
			version: "0.0.1",
		},

		async spawn(opts: RuntimeSpawnOpts): Promise<RuntimeHandle> {
			const envArray: string[] = [];
			if (opts.env) {
				for (const [key, value] of Object.entries(opts.env)) {
					envArray.push(`${key}=${value}`);
				}
			}
			for (const [key, value] of Object.entries(configEnv)) {
				envArray.push(`${key}=${value}`);
			}

			const binds = [`${opts.cwd}:${workspaceMountPath}`, ...extraBinds];

			let container: Docker.Container;
			try {
				container = await docker.createContainer({
					Image: image,
					Cmd: [opts.command, ...opts.args],
					WorkingDir: workspaceMountPath,
					Env: envArray,
					User: user,
					HostConfig: {
						Binds: binds,
						NetworkMode: network,
						Memory: memoryMb * 1024 * 1024,
						NanoCpus: cpus * 1e9,
						AutoRemove: false,
					},
					OpenStdin: true,
					Tty: false,
				});
			} catch (err) {
				const message =
					err instanceof Error ? err.message : String(err);
				throw new Error(
					`Failed to create Docker container. Is Docker installed and running? ${message}`,
				);
			}

			try {
				await container.start();
				const info = await container.inspect();
				return { id: container.id, pid: info.State.Pid };
			} catch (err) {
				// Clean up the created container on start/inspect failure
				try {
					await container.remove({ force: true });
				} catch {
					// Best-effort cleanup
				}
				const message =
					err instanceof Error ? err.message : String(err);
				throw new Error(
					`Failed to start Docker container: ${message}`,
				);
			}
		},

		async kill(handle: RuntimeHandle): Promise<void> {
			const container = docker.getContainer(handle.id);
			try {
				await container.stop({ t: stopTimeoutSeconds });
			} catch {
				// Container may already be stopped
			}
			try {
				await container.remove({ force: true });
			} catch {
				// Container may already be removed
			}
		},

		async isAlive(handle: RuntimeHandle): Promise<boolean> {
			try {
				const container = docker.getContainer(handle.id);
				const info = await container.inspect();
				return info.State.Running === true;
			} catch (err) {
				// Distinguish "container not found" (truly dead) from transient Docker errors
				const message = err instanceof Error ? err.message : String(err);
				if (message.includes("no such container") || message.includes("404")) {
					return false;
				}
				// Re-throw transient errors so the lifecycle worker doesn't mark healthy sessions as failed
				throw err;
			}
		},

		async sendInput(handle: RuntimeHandle, input: string): Promise<void> {
			const container = docker.getContainer(handle.id);
			// Attach to the container's stdin to send input to the main process
			const stream = await container.attach({
				stream: true,
				stdin: true,
				hijack: true,
			});
			stream.write(`${input}\n`);
			stream.end();
		},
	};
}

export default create;
