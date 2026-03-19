import type { Logger } from "@ultracoder/core";
import { describe, expect, it, vi } from "vitest";
import { MergeQueue } from "./merge-queue.js";

function mockLogger(): Logger {
	return {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		child: vi.fn().mockReturnThis(),
	};
}

describe("MergeQueue", () => {
	it("enqueues and dequeues in priority order", () => {
		const queue = new MergeQueue(mockLogger());
		queue.enqueue({ sessionId: "a", branch: "feat-a", priority: 1 });
		queue.enqueue({ sessionId: "b", branch: "feat-b", priority: 3 });
		queue.enqueue({ sessionId: "c", branch: "feat-c", priority: 2 });

		expect(queue.length).toBe(3);
		expect(queue.dequeue()?.sessionId).toBe("b"); // highest priority
		expect(queue.dequeue()?.sessionId).toBe("c");
		expect(queue.dequeue()?.sessionId).toBe("a");
	});

	it("peek returns front without removing", () => {
		const queue = new MergeQueue(mockLogger());
		queue.enqueue({ sessionId: "a", branch: "feat-a", priority: 1 });
		expect(queue.peek()?.sessionId).toBe("a");
		expect(queue.length).toBe(1);
	});

	it("remove specific session", () => {
		const queue = new MergeQueue(mockLogger());
		queue.enqueue({ sessionId: "a", branch: "feat-a", priority: 1 });
		queue.enqueue({ sessionId: "b", branch: "feat-b", priority: 2 });
		expect(queue.remove("a")).toBe(true);
		expect(queue.length).toBe(1);
		expect(queue.remove("nonexistent")).toBe(false);
	});
});
