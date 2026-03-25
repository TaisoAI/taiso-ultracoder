import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Plugin } from "@ultracoder/core";

export interface TerminalWebConfig {
	port?: number; // default: 3100
	host?: string; // default: "localhost"
}

export interface TerminalPlugin extends Plugin<"terminal"> {
	start(): Promise<{ url: string }>;
	stop(): Promise<void>;
}

export function create(config: TerminalWebConfig = {}): TerminalPlugin {
	const port = config.port ?? 3100;
	const host = config.host ?? "localhost";
	let server: ReturnType<typeof createServer> | null = null;

	return {
		meta: { name: "terminal-web", slot: "terminal", version: "0.0.1" },

		async start() {
			// Simple JSON API server for session monitoring
			server = createServer((req, res) => {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(
					JSON.stringify({
						status: "ok",
						message: "Ultracoder terminal web server",
					}),
				);
			});

			await new Promise<void>((resolve) => {
				server!.listen(port, host, resolve);
			});

			const addr = server!.address() as AddressInfo;
			return { url: `http://${host}:${addr.port}` };
		},

		async stop() {
			if (server) {
				await new Promise<void>((resolve, reject) => {
					server!.close((err) => (err ? reject(err) : resolve()));
				});
				server = null;
			}
		},
	};
}

export default create;
