import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { EventBus, UltracoderEvent } from "@ultracoder/core";
import { SSEManager } from "./sse.js";

function createMockEventBus(): EventBus & { fireAny: (e: UltracoderEvent) => void } {
	let anyHandler: ((event: UltracoderEvent) => void) | null = null;
	return {
		emit: vi.fn(),
		on: vi.fn(),
		off: vi.fn(),
		onAny: vi.fn((handler) => { anyHandler = handler; }),
		offAny: vi.fn(),
		fireAny(event: UltracoderEvent) {
			if (anyHandler) anyHandler(event);
		},
	};
}

function createMockResponse(): ServerResponse & { written: string[]; emitter: EventEmitter } {
	const emitter = new EventEmitter();
	const written: string[] = [];
	return {
		writeHead: vi.fn(),
		write: vi.fn((data: string) => { written.push(data); return true; }),
		end: vi.fn(),
		on: vi.fn((event: string, cb: () => void) => { emitter.on(event, cb); }),
		written,
		emitter,
	} as unknown as ServerResponse & { written: string[]; emitter: EventEmitter };
}

describe("SSEManager", () => {
	it("broadcasts events to all connected clients", () => {
		const bus = createMockEventBus();
		const sse = new SSEManager(bus);

		const res1 = createMockResponse();
		const res2 = createMockResponse();
		sse.addClient(res1);
		sse.addClient(res2);

		const event: UltracoderEvent = { type: "session.created", sessionId: "s1", task: "test" };
		bus.fireAny(event);

		// Both clients receive the SSE comment + the event data
		expect(res1.written).toContain(`data: ${JSON.stringify(event)}\n\n`);
		expect(res2.written).toContain(`data: ${JSON.stringify(event)}\n\n`);
	});

	it("removeClient stops sending to that client", () => {
		const bus = createMockEventBus();
		const sse = new SSEManager(bus);

		const res1 = createMockResponse();
		const res2 = createMockResponse();
		sse.addClient(res1);
		sse.addClient(res2);

		sse.removeClient(res1);

		const event: UltracoderEvent = { type: "session.completed", sessionId: "s1" };
		bus.fireAny(event);

		// res1 should only have the initial connection comment, not the event
		expect(res1.written).not.toContain(`data: ${JSON.stringify(event)}\n\n`);
		expect(res2.written).toContain(`data: ${JSON.stringify(event)}\n\n`);
	});

	it("clientCount reflects connected clients", () => {
		const bus = createMockEventBus();
		const sse = new SSEManager(bus);

		expect(sse.clientCount).toBe(0);

		const res1 = createMockResponse();
		const res2 = createMockResponse();
		sse.addClient(res1);
		expect(sse.clientCount).toBe(1);

		sse.addClient(res2);
		expect(sse.clientCount).toBe(2);

		sse.removeClient(res1);
		expect(sse.clientCount).toBe(1);

		sse.removeClient(res2);
		expect(sse.clientCount).toBe(0);
	});

	it("sets correct SSE headers on addClient", () => {
		const bus = createMockEventBus();
		const sse = new SSEManager(bus);
		const res = createMockResponse();

		sse.addClient(res);

		expect(res.writeHead).toHaveBeenCalledWith(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		});
	});
});
