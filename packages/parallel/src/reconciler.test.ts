import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { Logger } from "@ultracoder/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Reconciler } from "./reconciler.js";

vi.mock("node:child_process", () => ({
	execFile: vi.fn(),
}));

vi.mock("node:util", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		promisify: vi.fn((fn: unknown) => fn),
	};
});

const mockedExecFile = execFileCb as unknown as ReturnType<typeof vi.fn>;

function mockLogger(): Logger {
	return {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		child: vi.fn().mockReturnThis(),
	};
}

function succeedAll() {
	mockedExecFile.mockResolvedValue({ stdout: "ok", stderr: "" });
}

function failOnCommand(binary: string, args: string[], stderr: string) {
	mockedExecFile.mockImplementation(
		(bin: string, cmdArgs: string[], _opts: Record<string, unknown>) => {
			if (bin === binary && JSON.stringify(cmdArgs) === JSON.stringify(args)) {
				return Promise.reject({
					stdout: "",
					stderr,
					message: `Command failed: ${binary} ${args.join(" ")}`,
				});
			}
			return Promise.resolve({ stdout: "ok", stderr: "" });
		},
	);
}

describe("Reconciler", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("reports healthy when all commands succeed", async () => {
		succeedAll();
		const reconciler = new Reconciler({ projectPath: "/tmp/project" }, mockLogger());
		const result = await reconciler.reconcile();

		expect(result.healthy).toBe(true);
		expect(result.checksPerformed).toBe(3);
		expect(result.failures).toHaveLength(0);
		expect(result.fixDescriptions).toHaveLength(0);
	});

	it("detects typecheck failure", async () => {
		failOnCommand(
			"npx",
			["tsc", "--noEmit"],
			"src/index.ts(5,3): error TS2345: Argument of type 'string' is not assignable",
		);
		const reconciler = new Reconciler({ projectPath: "/tmp/project" }, mockLogger());
		const result = await reconciler.reconcile();

		expect(result.healthy).toBe(false);
		expect(result.failures).toHaveLength(1);
		expect(result.failures[0]).toContain("typecheck");
		expect(result.fixDescriptions.length).toBeGreaterThan(0);
		expect(result.fixDescriptions[0]).toContain("src/index.ts");
	});

	it("uses minIntervalMs on failure", async () => {
		failOnCommand("npx", ["tsc", "--noEmit"], "error TS2345: some error");
		const reconciler = new Reconciler(
			{ projectPath: "/tmp/project", minIntervalMs: 30_000, maxIntervalMs: 600_000 },
			mockLogger(),
		);
		const result = await reconciler.reconcile();

		expect(result.healthy).toBe(false);
		expect(result.intervalMs).toBe(30_000);
	});

	it("uses maxIntervalMs after 3 consecutive successes", async () => {
		succeedAll();
		const reconciler = new Reconciler(
			{ projectPath: "/tmp/project", minIntervalMs: 30_000, maxIntervalMs: 600_000 },
			mockLogger(),
		);

		// First two sweeps: still at min interval
		const r1 = await reconciler.reconcile();
		expect(r1.intervalMs).toBe(30_000);

		const r2 = await reconciler.reconcile();
		expect(r2.intervalMs).toBe(30_000);

		// Third sweep: now at max interval
		const r3 = await reconciler.reconcile();
		expect(r3.intervalMs).toBe(600_000);

		// Fourth sweep: stays at max
		const r4 = await reconciler.reconcile();
		expect(r4.intervalMs).toBe(600_000);
	});

	it("resets consecutive successes on failure", async () => {
		succeedAll();
		const reconciler = new Reconciler(
			{ projectPath: "/tmp/project", minIntervalMs: 30_000, maxIntervalMs: 600_000 },
			mockLogger(),
		);

		// Build up to 3 successes
		await reconciler.reconcile();
		await reconciler.reconcile();
		await reconciler.reconcile();
		const r3 = await reconciler.reconcile();
		expect(r3.intervalMs).toBe(600_000);

		// Now fail
		failOnCommand("pnpm", ["test"], "FAIL src/foo.test.ts");
		const rFail = await reconciler.reconcile();
		expect(rFail.intervalMs).toBe(30_000);

		// Need 3 more successes to get back to max
		succeedAll();
		const r4 = await reconciler.reconcile();
		expect(r4.intervalMs).toBe(30_000);
	});

	it("limits fix descriptions to maxFixTasks", async () => {
		const manyErrors = Array.from(
			{ length: 10 },
			(_, i) => `src/file${i}.ts(1,1): error TS0000: error in file${i}`,
		).join("\n");

		failOnCommand("npx", ["tsc", "--noEmit"], manyErrors);

		const reconciler = new Reconciler(
			{ projectPath: "/tmp/project", maxFixTasks: 3 },
			mockLogger(),
		);
		const result = await reconciler.reconcile();

		expect(result.fixDescriptions.length).toBeLessThanOrEqual(3);
	});

	it("deduplicates fix scopes across sweeps", async () => {
		failOnCommand(
			"npx",
			["tsc", "--noEmit"],
			"src/index.ts(5,3): error TS2345: Argument type mismatch",
		);

		const reconciler = new Reconciler({ projectPath: "/tmp/project" }, mockLogger());

		const r1 = await reconciler.reconcile();
		expect(r1.fixDescriptions.length).toBeGreaterThan(0);

		// Second sweep with same error — should be deduplicated
		const r2 = await reconciler.reconcile();
		expect(r2.fixDescriptions).toHaveLength(0);
		expect(reconciler.recentFixScopes.size).toBeGreaterThan(0);
	});

	it("clears fix scopes when clearFixScopes is called", async () => {
		failOnCommand(
			"npx",
			["tsc", "--noEmit"],
			"src/index.ts(5,3): error TS2345: Argument type mismatch",
		);

		const reconciler = new Reconciler({ projectPath: "/tmp/project" }, mockLogger());
		await reconciler.reconcile();
		expect(reconciler.recentFixScopes.size).toBeGreaterThan(0);

		reconciler.clearFixScopes();
		expect(reconciler.recentFixScopes.size).toBe(0);

		// After clearing, same errors should produce fix descriptions again
		const r2 = await reconciler.reconcile();
		expect(r2.fixDescriptions.length).toBeGreaterThan(0);
	});

	it("falls back to next command candidate when binary not found", async () => {
		mockedExecFile.mockImplementation(
			(bin: string, cmdArgs: string[], _opts: Record<string, unknown>) => {
				if (bin === "pnpm") {
					const err = new Error("ENOENT") as Error & { code: string };
					err.code = "ENOENT";
					return Promise.reject(err);
				}
				return Promise.resolve({ stdout: "ok", stderr: "" });
			},
		);

		const reconciler = new Reconciler({ projectPath: "/tmp/project" }, mockLogger());
		const result = await reconciler.reconcile();

		// Should succeed because it falls back to npm commands
		expect(result.healthy).toBe(true);
	});
});
