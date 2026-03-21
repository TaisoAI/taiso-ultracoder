import type { Logger } from "@ultracoder/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock child_process so we can control execFile in decomposeRecursive tests.
// vi.hoisted ensures the mock fn is available before vi.mock's hoisted factory runs.
const { mockExecFile } = vi.hoisted(() => {
	const fn = vi.fn();
	return { mockExecFile: fn };
});

vi.mock("node:child_process", async (importOriginal) => {
	const { promisify } = await import("node:util");
	const original = await importOriginal<typeof import("node:child_process")>();

	// Attach a custom promisify implementation so that
	// promisify(execFile) returns {stdout, stderr} like the real one.
	(mockExecFile as any)[promisify.custom] = (...args: any[]) => {
		return new Promise((resolve, reject) => {
			mockExecFile(...args, (err: any, stdout: any, stderr: any) => {
				if (err) {
					reject(err);
				} else {
					resolve({ stdout, stderr });
				}
			});
		});
	};

	return {
		...original,
		execFile: mockExecFile,
	};
});

import {
	buildExecutionOrder,
	decomposeTask,
	decomposeRecursive,
	shouldDecompose,
	parseDecompositionOutput,
	validateScopes,
} from "./decomposer.js";
import type { SubTask } from "./decomposer.js";

// ─── parseDecompositionOutput ────────────────────────────────────────

describe("parseDecompositionOutput", () => {
	it("parses valid JSON with subtasks", () => {
		const input = JSON.stringify({
			subtasks: [
				{
					id: "sub-1",
					title: "Set up routing",
					description: "Add route handlers",
					dependencies: [],
					scope: ["src/routes.ts"],
					priority: 1,
				},
				{
					id: "sub-2",
					title: "Add models",
					description: "Create data models",
					dependencies: ["sub-1"],
					scope: ["src/models.ts"],
					priority: 2,
				},
			],
		});

		const result = parseDecompositionOutput(input);
		expect(result).toHaveLength(2);
		expect(result[0].id).toBe("sub-1");
		expect(result[0].title).toBe("Set up routing");
		expect(result[0].scope).toEqual(["src/routes.ts"]);
		expect(result[1].dependencies).toEqual(["sub-1"]);
	});

	it("extracts JSON embedded in prose", () => {
		const input = `Sure! Here is the decomposition:

\`\`\`json
{
  "subtasks": [
    {
      "id": "sub-1",
      "title": "Implement parser",
      "description": "Write the parser module",
      "dependencies": [],
      "scope": ["src/parser.ts"],
      "priority": 1
    }
  ]
}
\`\`\`

Let me know if you need anything else.`;

		const result = parseDecompositionOutput(input);
		expect(result).toHaveLength(1);
		expect(result[0].id).toBe("sub-1");
		expect(result[0].title).toBe("Implement parser");
	});

	it("extracts JSON from prose without fenced code blocks", () => {
		const input = `Here is my analysis:
{
  "subtasks": [
    {
      "id": "sub-1",
      "title": "Task A",
      "description": "Do task A",
      "dependencies": [],
      "scope": ["a.ts"],
      "priority": 1
    }
  ]
}
That should work.`;

		const result = parseDecompositionOutput(input);
		expect(result).toHaveLength(1);
		expect(result[0].title).toBe("Task A");
	});

	it("returns empty array for invalid JSON", () => {
		const result = parseDecompositionOutput("this is not json at all");
		expect(result).toEqual([]);
	});

	it("returns empty array for JSON without subtasks array", () => {
		const result = parseDecompositionOutput('{ "foo": "bar" }');
		expect(result).toEqual([]);
	});

	it("returns empty array for completely empty input", () => {
		const result = parseDecompositionOutput("");
		expect(result).toEqual([]);
	});
});

// ─── validateScopes ─────────────────────────────────────────────────

describe("validateScopes", () => {
	it("returns true when no files overlap", () => {
		const subtasks: SubTask[] = [
			{
				id: "sub-1",
				title: "A",
				description: "A",
				dependencies: [],
				scope: ["a.ts", "b.ts"],
				priority: 1,
			},
			{
				id: "sub-2",
				title: "B",
				description: "B",
				dependencies: [],
				scope: ["c.ts", "d.ts"],
				priority: 2,
			},
		];
		expect(validateScopes(subtasks)).toBe(true);
	});

	it("returns false when files overlap between subtasks", () => {
		const subtasks: SubTask[] = [
			{
				id: "sub-1",
				title: "A",
				description: "A",
				dependencies: [],
				scope: ["a.ts", "shared.ts"],
				priority: 1,
			},
			{
				id: "sub-2",
				title: "B",
				description: "B",
				dependencies: [],
				scope: ["b.ts", "shared.ts"],
				priority: 2,
			},
		];
		expect(validateScopes(subtasks)).toBe(false);
	});

	it("returns true for empty subtask list", () => {
		expect(validateScopes([])).toBe(true);
	});

	it("returns true for subtasks with empty scopes", () => {
		const subtasks: SubTask[] = [
			{ id: "sub-1", title: "A", description: "A", dependencies: [], scope: [], priority: 1 },
			{ id: "sub-2", title: "B", description: "B", dependencies: [], scope: [], priority: 2 },
		];
		expect(validateScopes(subtasks)).toBe(true);
	});
});

// ─── buildExecutionOrder ────────────────────────────────────────────

describe("buildExecutionOrder", () => {
	it("puts all independent subtasks in a single wave", () => {
		const subtasks: SubTask[] = [
			{ id: "sub-1", title: "A", description: "A", dependencies: [], scope: ["a.ts"], priority: 1 },
			{ id: "sub-2", title: "B", description: "B", dependencies: [], scope: ["b.ts"], priority: 2 },
			{ id: "sub-3", title: "C", description: "C", dependencies: [], scope: ["c.ts"], priority: 3 },
		];
		const order = buildExecutionOrder(subtasks);
		expect(order).toHaveLength(1);
		expect(order[0]).toEqual(["sub-1", "sub-2", "sub-3"]);
	});

	it("separates dependent subtasks into waves", () => {
		const subtasks: SubTask[] = [
			{ id: "sub-1", title: "A", description: "A", dependencies: [], scope: ["a.ts"], priority: 1 },
			{
				id: "sub-2",
				title: "B",
				description: "B",
				dependencies: ["sub-1"],
				scope: ["b.ts"],
				priority: 2,
			},
			{
				id: "sub-3",
				title: "C",
				description: "C",
				dependencies: ["sub-2"],
				scope: ["c.ts"],
				priority: 3,
			},
		];
		const order = buildExecutionOrder(subtasks);
		expect(order).toHaveLength(3);
		expect(order[0]).toEqual(["sub-1"]);
		expect(order[1]).toEqual(["sub-2"]);
		expect(order[2]).toEqual(["sub-3"]);
	});

	it("handles diamond dependencies", () => {
		const subtasks: SubTask[] = [
			{ id: "sub-1", title: "A", description: "A", dependencies: [], scope: ["a.ts"], priority: 1 },
			{
				id: "sub-2",
				title: "B",
				description: "B",
				dependencies: ["sub-1"],
				scope: ["b.ts"],
				priority: 2,
			},
			{
				id: "sub-3",
				title: "C",
				description: "C",
				dependencies: ["sub-1"],
				scope: ["c.ts"],
				priority: 3,
			},
			{
				id: "sub-4",
				title: "D",
				description: "D",
				dependencies: ["sub-2", "sub-3"],
				scope: ["d.ts"],
				priority: 4,
			},
		];
		const order = buildExecutionOrder(subtasks);
		expect(order).toHaveLength(3);
		expect(order[0]).toEqual(["sub-1"]);
		expect(order[1]).toEqual(["sub-2", "sub-3"]);
		expect(order[2]).toEqual(["sub-4"]);
	});

	it("returns empty array for empty input", () => {
		expect(buildExecutionOrder([])).toEqual([]);
	});
});

// ─── decomposeTask ──────────────────────────────────────────────────

describe("decomposeTask", () => {
	const mockLogger: Logger = {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		child: vi.fn(() => mockLogger),
	};

	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("falls back to single subtask on agent error", async () => {
		// Make execFile call back with an error
		mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, cb?: any) => {
			const callback = typeof _opts === "function" ? _opts : cb;
			if (callback) callback(new Error("spawn ENOENT"), "", "");
			return {} as any;
		});

		const result = await decomposeTask(
			"Implement feature X",
			{ files: ["src/a.ts", "src/b.ts"] },
			mockLogger,
			{
				agentPath: "/nonexistent/binary/path",
				timeoutMs: 5000,
			},
		);

		expect(result.parentTask).toBe("Implement feature X");
		expect(result.subtasks).toHaveLength(1);
		expect(result.subtasks[0].id).toBe("sub-1");
		expect(result.subtasks[0].title).toBe("Implement feature X");
		expect(result.executionOrder).toEqual([["sub-1"]]);
		expect(mockLogger.error).toHaveBeenCalled();
	});
});

// ─── shouldDecompose ────────────────────────────────────────────────

describe("shouldDecompose", () => {
	it("returns false for small tasks below file threshold", () => {
		const subtask: SubTask = {
			id: "sub-1",
			title: "Small task",
			description: "A short description",
			dependencies: [],
			scope: ["a.ts", "b.ts"],
			priority: 1,
		};
		expect(shouldDecompose(subtask, 4)).toBe(false);
	});

	it("returns true when scope exceeds fileThreshold", () => {
		const subtask: SubTask = {
			id: "sub-1",
			title: "Large task",
			description: "A short description",
			dependencies: [],
			scope: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"],
			priority: 1,
		};
		expect(shouldDecompose(subtask, 4)).toBe(true);
	});

	it("returns true when description exceeds 500 chars", () => {
		const subtask: SubTask = {
			id: "sub-1",
			title: "Verbose task",
			description: "x".repeat(501),
			dependencies: [],
			scope: ["a.ts"],
			priority: 1,
		};
		expect(shouldDecompose(subtask, 4)).toBe(true);
	});

	it("returns false when scope equals fileThreshold exactly", () => {
		const subtask: SubTask = {
			id: "sub-1",
			title: "Borderline task",
			description: "Short",
			dependencies: [],
			scope: ["a.ts", "b.ts", "c.ts", "d.ts"],
			priority: 1,
		};
		expect(shouldDecompose(subtask, 4)).toBe(false);
	});

	it("returns false when description is exactly 500 chars", () => {
		const subtask: SubTask = {
			id: "sub-1",
			title: "Borderline task",
			description: "x".repeat(500),
			dependencies: [],
			scope: ["a.ts"],
			priority: 1,
		};
		expect(shouldDecompose(subtask, 4)).toBe(false);
	});
});

// ─── decomposeRecursive ────────────────────────────────────────────

describe("decomposeRecursive", () => {
	const mockLogger: Logger = {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		child: vi.fn(() => mockLogger),
	};

	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("single-level decomposition still works (backward compat)", async () => {
		// Agent errors → single subtask fallback, same as decomposeTask
		mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, cb?: any) => {
			const callback = typeof _opts === "function" ? _opts : cb;
			if (callback) callback(new Error("spawn ENOENT"), "", "");
			return {} as any;
		});

		const result = await decomposeRecursive(
			"Simple task",
			{ files: ["src/a.ts", "src/b.ts"] },
			mockLogger,
			{
				agentPath: "/nonexistent/binary/path",
				timeoutMs: 5000,
			},
		);

		expect(result.parentTask).toBe("Simple task");
		expect(result.subtasks).toHaveLength(1);
		expect(result.subtasks[0].title).toBe("Simple task");
		expect(result.executionOrder).toHaveLength(1);
	});

	it("recursively decomposes large subtasks", async () => {
		let callCount = 0;
		mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, cb?: any) => {
			callCount++;
			const callback = typeof _opts === "function" ? _opts : cb;
			if (callCount === 1) {
				// First call: top-level decomposition returns 2 subtasks
				// sub-1 has >4 files (should recurse), sub-2 has <=4 files (leaf)
				const output = JSON.stringify({
					subtasks: [
						{
							id: "sub-1",
							title: "Large subtask",
							description: "Handle many files",
							dependencies: [],
							scope: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"],
							priority: 1,
						},
						{
							id: "sub-2",
							title: "Small subtask",
							description: "Handle few files",
							dependencies: [],
							scope: ["f.ts"],
							priority: 2,
						},
					],
				});
				if (callback) callback(null, output, "");
			} else {
				// Second call: recursive decomposition of sub-1
				const output = JSON.stringify({
					subtasks: [
						{
							id: "sub-1",
							title: "Sub-sub A",
							description: "Part A",
							dependencies: [],
							scope: ["a.ts", "b.ts"],
							priority: 1,
						},
						{
							id: "sub-2",
							title: "Sub-sub B",
							description: "Part B",
							dependencies: [],
							scope: ["c.ts", "d.ts", "e.ts"],
							priority: 2,
						},
					],
				});
				if (callback) callback(null, output, "");
			}
			return {} as any;
		});

		const result = await decomposeRecursive(
			"Big task",
			{ files: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts"] },
			mockLogger,
			{
				agentPath: "mock-agent",
				maxDepth: 3,
				fileThreshold: 4,
			},
		);

		// Should have 3 leaf subtasks: sub-1's two children + sub-2
		expect(result.subtasks.length).toBe(3);
		// The sub-1 children should be prefixed
		expect(result.subtasks.some((s) => s.id.includes("sub-1"))).toBe(true);
		expect(result.parentTask).toBe("Big task");
	});

	it("respects maxDepth limit and stops recursing", async () => {
		// Always return subtasks with many files (would normally trigger recursion)
		mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, cb?: any) => {
			const callback = typeof _opts === "function" ? _opts : cb;
			const output = JSON.stringify({
				subtasks: [
					{
						id: "sub-1",
						title: "Always large",
						description: "Handle many files",
						dependencies: [],
						scope: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"],
						priority: 1,
					},
					{
						id: "sub-2",
						title: "Also large",
						description: "Handle many files too",
						dependencies: [],
						scope: ["f.ts", "g.ts", "h.ts", "i.ts", "j.ts"],
						priority: 2,
					},
				],
			});
			if (callback) callback(null, output, "");
			return {} as any;
		});

		const result = await decomposeRecursive(
			"Deep task",
			{ files: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts", "g.ts", "h.ts", "i.ts", "j.ts"] },
			mockLogger,
			{
				agentPath: "mock-agent",
				maxDepth: 2,
				fileThreshold: 4,
			},
		);

		// With maxDepth=2: level 0 decomposes -> 2 subtasks, level 1 each decomposes -> 2 subtasks
		// At level 2, depth (2) is NOT < maxDepth (2), so recursion stops
		// Total leaf subtasks: 4 (2 subtasks * 2 children each at depth 1)
		expect(result.subtasks.length).toBe(4);
	});

	it("returns flat list of leaf subtasks only", async () => {
		let callCount = 0;
		mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, cb?: any) => {
			callCount++;
			const callback = typeof _opts === "function" ? _opts : cb;
			if (callCount === 1) {
				const output = JSON.stringify({
					subtasks: [
						{
							id: "sub-1",
							title: "Parent A",
							description: "Large parent",
							dependencies: [],
							scope: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"],
							priority: 1,
						},
					],
				});
				if (callback) callback(null, output, "");
			} else {
				// sub-1 gets decomposed into 2 small children (leaves)
				const output = JSON.stringify({
					subtasks: [
						{
							id: "sub-1",
							title: "Child A",
							description: "Small child",
							dependencies: [],
							scope: ["a.ts", "b.ts"],
							priority: 1,
						},
						{
							id: "sub-2",
							title: "Child B",
							description: "Small child",
							dependencies: [],
							scope: ["c.ts", "d.ts", "e.ts"],
							priority: 2,
						},
					],
				});
				if (callback) callback(null, output, "");
			}
			return {} as any;
		});

		const result = await decomposeRecursive(
			"Flat check",
			{ files: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"] },
			mockLogger,
			{
				agentPath: "mock-agent",
				maxDepth: 3,
				fileThreshold: 4,
			},
		);

		// Parent "sub-1" should NOT appear — only its children
		expect(result.subtasks.every((s) => s.title !== "Parent A")).toBe(true);
		expect(result.subtasks.length).toBe(2);
	});

	it("handles decomposition failure at deeper levels gracefully", async () => {
		let callCount = 0;
		mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, cb?: any) => {
			callCount++;
			const callback = typeof _opts === "function" ? _opts : cb;
			if (callCount === 1) {
				// First call succeeds with a large subtask
				const output = JSON.stringify({
					subtasks: [
						{
							id: "sub-1",
							title: "Large task",
							description: "Handle many files",
							dependencies: [],
							scope: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"],
							priority: 1,
						},
						{
							id: "sub-2",
							title: "Small task",
							description: "Few files",
							dependencies: [],
							scope: ["f.ts"],
							priority: 2,
						},
					],
				});
				if (callback) callback(null, output, "");
			} else {
				// Recursive call fails — agent returns garbage
				if (callback) callback(null, "not valid json at all", "");
			}
			return {} as any;
		});

		const result = await decomposeRecursive(
			"Graceful fail",
			{ files: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts"] },
			mockLogger,
			{
				agentPath: "mock-agent",
				maxDepth: 3,
				fileThreshold: 4,
			},
		);

		// sub-1 recursive decomp fails -> agent returns single-subtask fallback
		// (decomposeTask catches parse failure and returns single subtask)
		// sub-2 is small -> kept as leaf
		// Result should have 2 subtasks total
		expect(result.subtasks.length).toBe(2);
		expect(result.parentTask).toBe("Graceful fail");
	});
});
