import type { Logger } from "@ultracoder/core";
import { type MockInstance, describe, expect, it, vi } from "vitest";
import { finalize } from "./finalization.js";
import { MergeQueue } from "./merge-queue.js";
import type { ReconcilerConfig, ReconcilerResult } from "./reconciler.js";
import * as reconcilerModule from "./reconciler.js";

function mockLogger(): Logger {
	return {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		child: vi.fn().mockReturnThis(),
	};
}

const baseConfig: ReconcilerConfig = {
	projectPath: "/tmp/test-project",
	minIntervalMs: 1000,
	maxIntervalMs: 5000,
	maxFixTasks: 5,
};

function healthyResult(checksPerformed = 3): ReconcilerResult {
	return {
		checksPerformed,
		healthy: true,
		failures: [],
		fixDescriptions: [],
		intervalMs: 5000,
	};
}

function unhealthyResult(
	fixes: string[] = ["Fix build error in src/foo.ts: type mismatch"],
): ReconcilerResult {
	return {
		checksPerformed: 3,
		healthy: false,
		failures: ["build: type error"],
		fixDescriptions: fixes,
		intervalMs: 1000,
	};
}

describe("finalize", () => {
	let reconcileSpy: MockInstance;

	function stubReconcile(...results: ReconcilerResult[]): void {
		reconcileSpy = vi.spyOn(reconcilerModule, "reconcile");
		for (const result of results) {
			reconcileSpy.mockResolvedValueOnce(result);
		}
	}

	it("exits early on healthy reconciler result", async () => {
		const logger = mockLogger();
		const queue = new MergeQueue(logger);
		stubReconcile(healthyResult());

		const result = await finalize(queue, { maxCycles: 3, reconcilerConfig: baseConfig }, logger);

		expect(result.cycles).toBe(1);
		expect(result.finalHealth).toBe(true);
		expect(result.fixesSpawned).toBe(0);
		expect(result.reconcilerResults).toHaveLength(1);
		expect(reconcileSpy).toHaveBeenCalledTimes(1);
	});

	it("runs all cycles when unhealthy", async () => {
		const logger = mockLogger();
		const queue = new MergeQueue(logger);
		stubReconcile(unhealthyResult(), unhealthyResult(), unhealthyResult());

		const result = await finalize(queue, { maxCycles: 3, reconcilerConfig: baseConfig }, logger);

		expect(result.cycles).toBe(3);
		expect(result.finalHealth).toBe(false);
		expect(result.reconcilerResults).toHaveLength(3);
		expect(reconcileSpy).toHaveBeenCalledTimes(3);
	});

	it("drains merge queue each cycle", async () => {
		const logger = mockLogger();
		const queue = new MergeQueue(logger);

		// Enqueue entries before finalization
		queue.enqueue({ sessionId: "a", branch: "feat-a", priority: 1 });
		queue.enqueue({ sessionId: "b", branch: "feat-b", priority: 2 });
		expect(queue.length).toBe(2);

		stubReconcile(healthyResult());

		const result = await finalize(queue, { maxCycles: 1, reconcilerConfig: baseConfig }, logger);

		expect(queue.length).toBe(0);
		expect(result.finalHealth).toBe(true);
	});

	it("accumulates fix count across cycles", async () => {
		const logger = mockLogger();
		const queue = new MergeQueue(logger);

		const twoFixes = unhealthyResult(["fix A", "fix B"]);
		const oneFix = unhealthyResult(["fix C"]);
		stubReconcile(twoFixes, oneFix, unhealthyResult(["fix D"]));

		const result = await finalize(queue, { maxCycles: 3, reconcilerConfig: baseConfig }, logger);

		// 2 + 1 + 1 = 4
		expect(result.fixesSpawned).toBe(4);
		expect(result.finalHealth).toBe(false);
		expect(result.cycles).toBe(3);
	});

	it("becomes healthy mid-way and stops", async () => {
		const logger = mockLogger();
		const queue = new MergeQueue(logger);
		stubReconcile(unhealthyResult(["fix X"]), healthyResult());

		const result = await finalize(queue, { maxCycles: 5, reconcilerConfig: baseConfig }, logger);

		expect(result.cycles).toBe(2);
		expect(result.fixesSpawned).toBe(1);
		expect(result.finalHealth).toBe(true);
		expect(result.reconcilerResults).toHaveLength(2);
	});
});
