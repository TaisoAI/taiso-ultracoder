import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import type { Deps } from "@ultracoder/core";
import { createEventBus, type EventBus } from "@ultracoder/core";
import { handleHealth, handleSessionDetail, handleSessionsList } from "./api.js";
import { renderDashboardHTML } from "./dashboard.js";
import { SSEManager } from "./sse.js";
import { mapGitHubEvent, verifyGitHubSignature } from "./webhooks.js";

export interface WebServerConfig {
	port: number;
	host: string;
	webhookSecret?: string;
}

const DEFAULT_CONFIG: WebServerConfig = {
	port: 3100,
	host: "localhost",
};

export class WebServer {
	private server: Server | null = null;
	private sse: SSEManager;
	private eventBus: EventBus;
	private config: WebServerConfig;

	constructor(
		private deps: Deps,
		config?: Partial<WebServerConfig>,
	) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.eventBus = deps.events ?? createEventBus();
		this.sse = new SSEManager(this.eventBus);
	}

	async start(): Promise<{ url: string }> {
		return new Promise((resolve, reject) => {
			const server = createServer((req, res) => {
				this.handleRequest(req, res).catch((err) => {
					this.sendJson(res, 500, {
						error: "Internal server error",
						message: String(err),
					});
				});
			});

			server.on("error", reject);

			server.listen(this.config.port, this.config.host, () => {
				this.server = server;
				const url = `http://${this.config.host}:${this.config.port}`;
				resolve({ url });
			});
		});
	}

	async stop(): Promise<void> {
		return new Promise((resolve, reject) => {
			if (!this.server) {
				resolve();
				return;
			}
			this.server.close((err) => {
				this.server = null;
				if (err) reject(err);
				else resolve();
			});
		});
	}

	private async handleRequest(
		req: IncomingMessage,
		res: ServerResponse,
	): Promise<void> {
		const url = req.url ?? "/";
		const method = req.method ?? "GET";

		// GET / → dashboard
		if (method === "GET" && url === "/") {
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(renderDashboardHTML());
			return;
		}

		// GET /api/health
		if (method === "GET" && url === "/api/health") {
			this.sendJson(res, 200, handleHealth());
			return;
		}

		// GET /api/sessions
		if (method === "GET" && url === "/api/sessions") {
			const sessions = await handleSessionsList(this.deps);
			this.sendJson(res, 200, sessions);
			return;
		}

		// GET /api/sessions/<id>
		if (method === "GET" && url.startsWith("/api/sessions/")) {
			const id = url.slice("/api/sessions/".length);
			if (!id) {
				this.sendJson(res, 400, { error: "Missing session ID" });
				return;
			}
			const result = await handleSessionDetail(this.deps, id);
			if ("statusCode" in result && result.statusCode === 404) {
				this.sendJson(res, 404, result);
			} else {
				this.sendJson(res, 200, result);
			}
			return;
		}

		// GET /api/events → SSE
		if (method === "GET" && url === "/api/events") {
			this.sse.addClient(res);
			return;
		}

		// POST /webhooks/github
		if (method === "POST" && url === "/webhooks/github") {
			await this.handleGitHubWebhook(req, res);
			return;
		}

		// 404
		this.sendJson(res, 404, { error: "Not found" });
	}

	private async handleGitHubWebhook(
		req: IncomingMessage,
		res: ServerResponse,
	): Promise<void> {
		const body = await this.readBody(req);

		if (this.config.webhookSecret) {
			const signature =
				(req.headers["x-hub-signature-256"] as string) ?? "";
			if (
				!verifyGitHubSignature(body, signature, this.config.webhookSecret)
			) {
				this.sendJson(res, 401, { error: "Invalid signature" });
				return;
			}
		}

		let payload: Record<string, unknown>;
		try {
			payload = JSON.parse(body) as Record<string, unknown>;
		} catch {
			this.sendJson(res, 400, { error: "Invalid JSON" });
			return;
		}

		const eventType = (req.headers["x-github-event"] as string) ?? "";
		const event = mapGitHubEvent(eventType, payload);

		if (event) {
			this.eventBus.emit(event);
			this.sendJson(res, 200, { accepted: true, eventType: event.type });
		} else {
			this.sendJson(res, 200, { accepted: false, reason: "Unhandled event type" });
		}
	}

	private readBody(req: IncomingMessage): Promise<string> {
		return new Promise((resolve, reject) => {
			const chunks: Buffer[] = [];
			req.on("data", (chunk: Buffer) => chunks.push(chunk));
			req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
			req.on("error", reject);
		});
	}

	private sendJson(
		res: ServerResponse,
		statusCode: number,
		data: unknown,
	): void {
		res.writeHead(statusCode, { "Content-Type": "application/json" });
		res.end(JSON.stringify(data));
	}
}
