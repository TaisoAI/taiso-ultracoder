import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Orchestrator } from "./orchestrator.js";
import type { OrchestratorCallbacks } from "./orchestrator.js";
import type { Deps, Logger } from "./types.js";

function mockLogger(): Logger {
	return {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		child: vi.fn().mockReturnThis(),
	};
}

function mockDeps(logger: Logger): Deps {
	return {
		config: {} as Deps["config"],
		logger,
		plugins: {} as Deps["plugins"],
		sessions: {} as Deps["sessions"],
		paths: {} as Deps["paths"],
	};
}

function mockCallbacks(): OrchestratorCallbacks & {
	pollSessions: ReturnType<typeof vi.fn>;
	processMergeQueue: ReturnType<typeof vi.fn>;
	runReconciler: ReturnType<typeof vi.fn>;
} {
	return {
		pollSessions: vi.fn().mockResolvedValue(undefined),
		processMergeQueue: vi.fn().mockResolvedValue(undefined),
		runReconciler: vi.fn().mockResolvedValue({ healthy: true, fixes: [] }),
	};
}

describe("Orchestrator", () => {
	let logger: Logger;
	let deps: Deps;
	let callbacks: ReturnType<typeof mockCallbacks>;
	let orchestrator: Orchestrator;

	beforeEach(() => {
		vi.useFakeTimers();
		logger = mockLogger();
		deps = mockDeps(logger);
		callbacks = mockCallbacks();
	});

	afterEach(() => {
		orchestrator?.stop();
		vi.useRealTimers();
	});

	it("starts and sets running to true", () => {
		orchestrator = new Orchestrator(deps, callbacks);
		expect(orchestrator.running).toBe(false);

		orchestrator.start();
		expect(orchestrator.running).toBe(true);
	});

	it("stops and sets running to false", () => {
		orchestrator = new Orchestrator(deps, callbacks);
		orchestrator.start();
		orchestrator.stop();
		expect(orchestrator.running).toBe(false);
	});

	it("warns when starting an already-running orchestrator", () => {
		orchestrator = new Orchestrator(deps, callbacks);
		orchestrator.start();
		orchestrator.start(); // second call
		expect(logger.warn).toHaveBeenCalledWith("Orchestrator already running");
	});

	it("warns when stopping a non-running orchestrator", () => {
		orchestrator = new Orchestrator(deps, callbacks);
		orchestrator.stop();
		expect(logger.warn).toHaveBeenCalledWith("Orchestrator is not running");
	});

	it("runCycle calls pollSessions and processMergeQueue", async () => {
		orchestrator = new Orchestrator(deps, callbacks);
		await orchestrator.runCycle();

		expect(callbacks.pollSessions).toHaveBeenCalledOnce();
		expect(callbacks.processMergeQueue).toHaveBeenCalledOnce();
	});

	it("runCycle calls reconciler on every 5th cycle", async () => {
		orchestrator = new Orchestrator(deps, callbacks);

		// Cycles 1-4 should not call reconciler
		for (let i = 0; i < 4; i++) {
			await orchestrator.runCycle();
		}
		expect(callbacks.runReconciler).not.toHaveBeenCalled();

		// 5th cycle should call reconciler
		await orchestrator.runCycle();
		expect(callbacks.runReconciler).toHaveBeenCalledOnce();
	});

	it("runCycle logs warning when reconciler reports unhealthy", async () => {
		callbacks.runReconciler.mockResolvedValue({
			healthy: false,
			fixes: ["fixed orphan session"],
		});

		orchestrator = new Orchestrator(deps, callbacks);
		// Run 5 cycles to trigger reconciler
		for (let i = 0; i < 5; i++) {
			await orchestrator.runCycle();
		}

		expect(logger.warn).toHaveBeenCalledWith("Reconciler found issues", {
			fixes: ["fixed orphan session"],
		});
	});

	it("runCycle catches and logs errors", async () => {
		callbacks.pollSessions.mockRejectedValue(new Error("poll failed"));
		orchestrator = new Orchestrator(deps, callbacks);

		await orchestrator.runCycle();

		expect(logger.error).toHaveBeenCalledWith("Cycle failed", {
			cycleId: 1,
			error: "poll failed",
		});
	});

	it("start triggers cycles on interval", async () => {
		orchestrator = new Orchestrator(deps, callbacks, { pollIntervalMs: 1000 });
		orchestrator.start();

		// First cycle runs immediately
		await vi.advanceTimersByTimeAsync(0);
		expect(callbacks.pollSessions).toHaveBeenCalledTimes(1);

		// After 1 second, another cycle
		await vi.advanceTimersByTimeAsync(1000);
		expect(callbacks.pollSessions).toHaveBeenCalledTimes(2);

		// After another second, another cycle
		await vi.advanceTimersByTimeAsync(1000);
		expect(callbacks.pollSessions).toHaveBeenCalledTimes(3);
	});

	it("uses custom config values", () => {
		orchestrator = new Orchestrator(deps, callbacks, {
			pollIntervalMs: 5000,
			enableLLMDecisions: true,
			agentPath: "/usr/bin/agent",
		});

		expect(orchestrator.running).toBe(false);
		// Config is applied internally; we just verify construction doesn't throw
	});
});
