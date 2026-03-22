import { describe, expect, it, vi } from "vitest";
import { createEventBus } from "./events.js";
import type { UltracoderEvent } from "./events.js";

describe("createEventBus", () => {
	it("returns a bus with emit/on/off/onAny methods", () => {
		const bus = createEventBus();
		expect(typeof bus.emit).toBe("function");
		expect(typeof bus.on).toBe("function");
		expect(typeof bus.off).toBe("function");
		expect(typeof bus.onAny).toBe("function");
	});

	it("typed on receives only matching events", () => {
		const bus = createEventBus();
		const handler = vi.fn();
		bus.on("session.spawned", handler);

		const spawned: UltracoderEvent = {
			type: "session.spawned",
			sessionId: "s1",
			task: "fix bug",
			timestamp: new Date().toISOString(),
		};
		const completed: UltracoderEvent = {
			type: "session.completed",
			sessionId: "s1",
			timestamp: new Date().toISOString(),
		};

		bus.emit(spawned);
		bus.emit(completed);

		expect(handler).toHaveBeenCalledOnce();
		expect(handler).toHaveBeenCalledWith(spawned);
	});

	it("onAny receives all emitted events", () => {
		const bus = createEventBus();
		const handler = vi.fn();
		bus.onAny(handler);

		const ev1: UltracoderEvent = {
			type: "session.spawned",
			sessionId: "s1",
			task: "t",
			timestamp: "2024-01-01T00:00:00Z",
		};
		const ev2: UltracoderEvent = {
			type: "pr.opened",
			sessionId: "s1",
			prId: "pr-1",
			timestamp: "2024-01-01T00:00:00Z",
		};

		bus.emit(ev1);
		bus.emit(ev2);

		expect(handler).toHaveBeenCalledTimes(2);
		expect(handler).toHaveBeenCalledWith(ev1);
		expect(handler).toHaveBeenCalledWith(ev2);
	});

	it("off successfully unregisters a handler", () => {
		const bus = createEventBus();
		const handler = vi.fn();
		bus.on("ci.passed", handler);

		const event: UltracoderEvent = {
			type: "ci.passed",
			sessionId: "s1",
			ref: "abc123",
			timestamp: "2024-01-01T00:00:00Z",
		};

		bus.emit(event);
		expect(handler).toHaveBeenCalledOnce();

		bus.off("ci.passed", handler);
		bus.emit(event);
		expect(handler).toHaveBeenCalledOnce();
	});

	it("multiple listeners on same type all fire", () => {
		const bus = createEventBus();
		const handler1 = vi.fn();
		const handler2 = vi.fn();
		bus.on("issue.detected", handler1);
		bus.on("issue.detected", handler2);

		const event: UltracoderEvent = {
			type: "issue.detected",
			issueId: "i-1",
			title: "Bug",
			timestamp: "2024-01-01T00:00:00Z",
		};

		bus.emit(event);
		expect(handler1).toHaveBeenCalledOnce();
		expect(handler2).toHaveBeenCalledOnce();
	});

	it("emitting events does not crash when no listeners registered", () => {
		const bus = createEventBus();

		expect(() => {
			bus.emit({
				type: "merge.conflict",
				sessionId: "s1",
				branch: "feat/x",
				timestamp: "2024-01-01T00:00:00Z",
			});
		}).not.toThrow();
	});
});
