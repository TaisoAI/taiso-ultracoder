import type { ServerResponse } from "node:http";
import type { EventBus, UltracoderEvent } from "@ultracoder/core";

/**
 * Server-Sent Events manager.
 * Subscribes to the EventBus and broadcasts events to all connected clients.
 */
export class SSEManager {
	private clients = new Set<ServerResponse>();

	constructor(eventBus: EventBus) {
		eventBus.onAny((event) => this.broadcast(event));
	}

	/** Register a new SSE client. Sets appropriate headers and handles disconnect. */
	addClient(res: ServerResponse): void {
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		});
		// Send initial comment to establish connection
		res.write(": connected\n\n");

		this.clients.add(res);

		res.on("close", () => {
			this.removeClient(res);
		});
	}

	/** Remove a client from the broadcast set. */
	removeClient(res: ServerResponse): void {
		this.clients.delete(res);
	}

	/** Broadcast an event to all connected clients. */
	broadcast(event: UltracoderEvent): void {
		const data = `data: ${JSON.stringify(event)}\n\n`;
		for (const client of this.clients) {
			client.write(data);
		}
	}

	/** Number of currently connected clients. */
	get clientCount(): number {
		return this.clients.size;
	}
}
