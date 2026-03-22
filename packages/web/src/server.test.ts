import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Deps } from "@ultracoder/core";
import { WebServer } from "./server.js";

function createMockDeps(): Deps {
	return {
		config: {} as Deps["config"],
		logger: {
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			child: vi.fn().mockReturnThis(),
		},
		plugins: {
			register: vi.fn(),
			get: vi.fn(),
			getAll: vi.fn().mockReturnValue(new Map()),
			has: vi.fn().mockReturnValue(false),
		},
		sessions: {
			create: vi.fn(),
			get: vi.fn(),
			update: vi.fn(),
			transition: vi.fn(),
			list: vi.fn().mockResolvedValue([]),
			archive: vi.fn(),
			delete: vi.fn(),
		},
		paths: {
			dataDir: vi.fn().mockReturnValue("/tmp/data"),
			sessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			sessionDir: vi.fn().mockReturnValue("/tmp/sessions/s1"),
			sessionFile: vi.fn().mockReturnValue("/tmp/sessions/s1/session.json"),
			logsDir: vi.fn().mockReturnValue("/tmp/sessions/s1/logs"),
			archiveDir: vi.fn().mockReturnValue("/tmp/archive"),
			issuesDir: vi.fn().mockReturnValue("/tmp/issues"),
		},
	};
}

function get(url: string): Promise<{ statusCode: number; body: string; headers: http.IncomingHttpHeaders }> {
	return new Promise((resolve, reject) => {
		http.get(url, (res) => {
			const chunks: Buffer[] = [];
			res.on("data", (chunk: Buffer) => chunks.push(chunk));
			res.on("end", () => {
				resolve({
					statusCode: res.statusCode ?? 0,
					body: Buffer.concat(chunks).toString("utf8"),
					headers: res.headers,
				});
			});
		}).on("error", reject);
	});
}

describe("WebServer", () => {
	let server: WebServer | null = null;

	afterEach(async () => {
		if (server) {
			await server.stop();
			server = null;
		}
	});

	it("starts and stops cleanly", async () => {
		const deps = createMockDeps();
		server = new WebServer(deps, { port: 0, host: "127.0.0.1" });

		// Use port 0 to let the OS assign an available port
		const { url } = await server.start();
		expect(url).toContain("http://");

		await server.stop();
		server = null;
	});

	it("health endpoint returns 200 with status ok", async () => {
		const deps = createMockDeps();
		// Pick a random high port to avoid conflicts
		const port = 30000 + Math.floor(Math.random() * 10000);
		server = new WebServer(deps, { port, host: "127.0.0.1" });
		const { url } = await server.start();

		const res = await get(`${url}/api/health`);
		expect(res.statusCode).toBe(200);

		const data = JSON.parse(res.body);
		expect(data.status).toBe("ok");
		expect(typeof data.uptime).toBe("number");
	});

	it("dashboard endpoint returns HTML content", async () => {
		const deps = createMockDeps();
		const port = 30000 + Math.floor(Math.random() * 10000);
		server = new WebServer(deps, { port, host: "127.0.0.1" });
		const { url } = await server.start();

		const res = await get(`${url}/`);
		expect(res.statusCode).toBe(200);
		expect(res.headers["content-type"]).toContain("text/html");
		expect(res.body).toContain("Ultracoder Dashboard");
	});

	it("returns 404 for unknown routes", async () => {
		const deps = createMockDeps();
		const port = 30000 + Math.floor(Math.random() * 10000);
		server = new WebServer(deps, { port, host: "127.0.0.1" });
		const { url } = await server.start();

		const res = await get(`${url}/nonexistent`);
		expect(res.statusCode).toBe(404);
	});

	it("sessions endpoint returns session list", async () => {
		const deps = createMockDeps();
		(deps.sessions.list as ReturnType<typeof vi.fn>).mockResolvedValue([
			{
				id: "s1",
				projectId: "p1",
				task: "test task",
				status: "working",
				agentType: "claude-code",
				workspacePath: "/tmp",
				branch: "main",
				createdAt: "2026-01-01T00:00:00Z",
				updatedAt: "2026-01-01T00:00:00Z",
				metadata: {},
			},
		]);
		const port = 30000 + Math.floor(Math.random() * 10000);
		server = new WebServer(deps, { port, host: "127.0.0.1" });
		const { url } = await server.start();

		const res = await get(`${url}/api/sessions`);
		expect(res.statusCode).toBe(200);

		const data = JSON.parse(res.body);
		expect(Array.isArray(data)).toBe(true);
		expect(data).toHaveLength(1);
		expect(data[0].id).toBe("s1");
		expect(data[0].status).toBe("working");
	});
});
