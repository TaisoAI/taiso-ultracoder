import type { Logger } from "@ultracoder/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	buildExecutionOrder,
	decomposeTask,
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
		const result = await decomposeTask(
			"Implement feature X",
			{ files: ["src/a.ts", "src/b.ts"] },
			mockLogger,
			{
				// Use a nonexistent binary to force an error
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
