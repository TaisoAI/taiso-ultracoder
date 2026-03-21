import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { Logger } from "@ultracoder/core";

const execFile = promisify(execFileCb);

export interface SubTask {
	id: string;
	title: string;
	description: string;
	dependencies: string[];
	scope: string[];
	priority: number;
}

export interface DecompositionResult {
	parentTask: string;
	subtasks: SubTask[];
	executionOrder: string[][];
}

export interface DecomposerConfig {
	/** Path to agent CLI binary. Default: "claude" */
	agentPath?: string;
	/** Max recursion depth for recursive decomposition. Default: 3 */
	maxDepth?: number;
	/** Max subtasks per decomposition level. Default: 10 */
	maxSubtasks?: number;
	/** Timeout per decomposition call in ms. Default: 120000 */
	timeoutMs?: number;
	/** File count threshold to trigger further decomposition. Default: 4 */
	fileThreshold?: number;
}

const DECOMPOSE_PROMPT = `You are a task decomposer. Break the following task into parallelizable subtasks.

Task: {task}

Project files:
{fileList}

Rules:
- Each subtask must have a clear, specific title and description
- Each subtask must list the files it will modify (scope)
- No two subtasks should have overlapping file scopes
- List dependencies between subtasks (by ID)
- Assign priority (1=highest)
- Maximum {maxSubtasks} subtasks

Respond in this exact JSON format:
{
  "subtasks": [
    {
      "id": "sub-1",
      "title": "...",
      "description": "...",
      "dependencies": [],
      "scope": ["src/file1.ts", "src/file2.ts"],
      "priority": 1
    }
  ]
}

If the task is simple enough to do in one step, return a single subtask.`;

/**
 * Parse JSON subtasks from agent output that may contain prose around the JSON.
 */
export function parseDecompositionOutput(output: string): SubTask[] {
	// Try to extract a JSON block from the output
	// Look for ```json ... ``` fenced blocks first
	const fencedMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
	const jsonCandidate = fencedMatch ? fencedMatch[1].trim() : output.trim();

	// Try to find a JSON object in the candidate string
	const jsonMatch = jsonCandidate.match(/\{[\s\S]*\}/);
	if (!jsonMatch) {
		return [];
	}

	try {
		const parsed = JSON.parse(jsonMatch[0]);
		const subtasks: unknown[] = parsed.subtasks;
		if (!Array.isArray(subtasks)) {
			return [];
		}

		return subtasks.filter(isValidSubTask).map((st) => ({
			id: String(st.id),
			title: String(st.title),
			description: String(st.description),
			dependencies: Array.isArray(st.dependencies) ? st.dependencies.map(String) : [],
			scope: Array.isArray(st.scope) ? st.scope.map(String) : [],
			priority: typeof st.priority === "number" ? st.priority : 5,
		}));
	} catch {
		return [];
	}
}

function isValidSubTask(st: unknown): st is {
	id: unknown;
	title: unknown;
	description: unknown;
	dependencies?: unknown;
	scope?: unknown;
	priority?: unknown;
} {
	if (typeof st !== "object" || st === null) return false;
	const obj = st as Record<string, unknown>;
	return (
		typeof obj.id !== "undefined" &&
		typeof obj.title !== "undefined" &&
		typeof obj.description !== "undefined"
	);
}

/**
 * Validate that no two subtasks share files in their scopes.
 */
export function validateScopes(subtasks: SubTask[]): boolean {
	const seen = new Set<string>();
	for (const st of subtasks) {
		for (const file of st.scope) {
			if (seen.has(file)) {
				return false;
			}
			seen.add(file);
		}
	}
	return true;
}

/**
 * Topologically sort subtasks into parallel execution waves.
 * Each wave contains subtask IDs that can execute concurrently.
 */
export function buildExecutionOrder(subtasks: SubTask[]): string[][] {
	if (subtasks.length === 0) return [];

	const idSet = new Set(subtasks.map((st) => st.id));
	const depMap = new Map<string, string[]>();
	const inDegree = new Map<string, number>();

	for (const st of subtasks) {
		// Only count dependencies that reference known subtask IDs
		const validDeps = st.dependencies.filter((d) => idSet.has(d));
		depMap.set(st.id, validDeps);
		inDegree.set(st.id, validDeps.length);
	}

	const waves: string[][] = [];
	const remaining = new Set(idSet);

	while (remaining.size > 0) {
		// Find all nodes with in-degree 0
		const wave: string[] = [];
		for (const id of remaining) {
			if ((inDegree.get(id) ?? 0) === 0) {
				wave.push(id);
			}
		}

		if (wave.length === 0) {
			// Cycle detected — dump remaining into a final wave
			waves.push([...remaining]);
			break;
		}

		// Sort wave by priority for deterministic ordering
		const priorityMap = new Map(subtasks.map((st) => [st.id, st.priority]));
		wave.sort((a, b) => (priorityMap.get(a) ?? 5) - (priorityMap.get(b) ?? 5));

		waves.push(wave);

		// Remove processed nodes and update in-degrees
		for (const id of wave) {
			remaining.delete(id);
		}
		for (const id of remaining) {
			const deps = depMap.get(id) ?? [];
			let newDeg = 0;
			for (const dep of deps) {
				if (remaining.has(dep)) {
					newDeg++;
				}
			}
			inDegree.set(id, newDeg);
		}
	}

	return waves;
}

function buildPrompt(task: string, files: string[], maxSubtasks: number): string {
	const fileList = files.map((f) => `- ${f}`).join("\n");
	return DECOMPOSE_PROMPT.replace("{task}", task)
		.replace("{fileList}", fileList)
		.replace("{maxSubtasks}", String(maxSubtasks));
}

function singleSubtaskResult(task: string, files: string[]): DecompositionResult {
	const subtask: SubTask = {
		id: "sub-1",
		title: task,
		description: task,
		dependencies: [],
		scope: files.slice(0, 10),
		priority: 1,
	};
	return {
		parentTask: task,
		subtasks: [subtask],
		executionOrder: [[subtask.id]],
	};
}

/**
 * Task decomposition: breaks a large task into parallelizable subtasks
 * by spawning a short-lived agent process with a decomposition prompt.
 *
 * Falls back to a single subtask if the agent errors or output cannot be parsed.
 */
export async function decomposeTask(
	task: string,
	projectContext: { files: string[]; description?: string },
	logger: Logger,
	config?: DecomposerConfig,
): Promise<DecompositionResult> {
	const { agentPath = "claude", maxSubtasks = 10, timeoutMs = 120_000 } = config ?? {};

	logger.info("Decomposing task", {
		task,
		fileCount: projectContext.files.length,
	});

	const prompt = buildPrompt(task, projectContext.files, maxSubtasks);

	try {
		const { stdout } = await execFile(agentPath, ["-p", prompt, "--output-format", "text"], {
			timeout: timeoutMs,
			maxBuffer: 10 * 1024 * 1024,
		});

		const subtasks = parseDecompositionOutput(stdout);

		if (subtasks.length === 0) {
			logger.warn("Could not parse subtasks from agent output, using single-task fallback");
			return singleSubtaskResult(task, projectContext.files);
		}

		if (!validateScopes(subtasks)) {
			logger.warn("Subtask scopes overlap, using single-task fallback");
			return singleSubtaskResult(task, projectContext.files);
		}

		const executionOrder = buildExecutionOrder(subtasks);

		logger.info("Decomposition complete", {
			subtaskCount: subtasks.length,
			waveCount: executionOrder.length,
		});

		return {
			parentTask: task,
			subtasks,
			executionOrder,
		};
	} catch (err) {
		logger.error("Agent decomposition failed, using single-task fallback", {
			error: err instanceof Error ? err.message : String(err),
		});
		return singleSubtaskResult(task, projectContext.files);
	}
}

/**
 * Determine whether a subtask is large enough to warrant further decomposition.
 * Returns true if the subtask's scope exceeds the file threshold or its
 * description is longer than 500 characters.
 */
export function shouldDecompose(subtask: SubTask, fileThreshold: number): boolean {
	if (subtask.scope.length > fileThreshold) {
		return true;
	}
	if (subtask.description.length > 500) {
		return true;
	}
	return false;
}

/**
 * Recursively decompose a task. Large subtasks are broken down further
 * until maxDepth is reached or subtasks are small enough.
 *
 * Returns a flat list of leaf-level subtasks and execution order waves.
 */
export async function decomposeRecursive(
	task: string,
	projectContext: { files: string[]; description?: string },
	logger: Logger,
	config?: DecomposerConfig,
): Promise<DecompositionResult> {
	const {
		maxDepth = 3,
		fileThreshold = 4,
	} = config ?? {};

	const decomposedParents = new Map<string, string[]>();
	const leafSubtasks = await decomposeRecursiveInternal(
		task,
		projectContext,
		logger,
		config,
		0,
		maxDepth,
		fileThreshold,
		"",
		decomposedParents,
	);

	// Remap dependencies: if a subtask depends on a parent that was decomposed,
	// replace that dependency with all of the parent's leaf children.
	// This ensures siblings wait for ALL children of a decomposed parent.
	if (decomposedParents.size > 0) {
		for (const st of leafSubtasks) {
			st.dependencies = st.dependencies.flatMap((dep) => {
				const children = decomposedParents.get(dep);
				return children ?? [dep];
			});
		}
	}

	const executionOrder = buildExecutionOrder(leafSubtasks);

	return {
		parentTask: task,
		subtasks: leafSubtasks,
		executionOrder,
	};
}

async function decomposeRecursiveInternal(
	task: string,
	projectContext: { files: string[]; description?: string },
	logger: Logger,
	config: DecomposerConfig | undefined,
	currentDepth: number,
	maxDepth: number,
	fileThreshold: number,
	idPrefix: string,
	decomposedParents: Map<string, string[]>,
): Promise<SubTask[]> {
	const result = await decomposeTask(task, projectContext, logger, config);

	const allLeaves: SubTask[] = [];

	for (const subtask of result.subtasks) {
		// A single subtask that equals the original task means decomposition
		// didn't actually split the work. Only recurse if we got multiple subtasks
		// or the single subtask is different from the parent (i.e., was refined).
		if (result.subtasks.length === 1 && subtask.title === task) {
			allLeaves.push(...reIdSubtasks([subtask], idPrefix));
			continue;
		}
		if (shouldDecompose(subtask, fileThreshold) && currentDepth + 1 < maxDepth) {
			logger.info("Recursively decomposing subtask", {
				subtaskId: subtask.id,
				depth: currentDepth + 1,
				scopeSize: subtask.scope.length,
			});

			try {
				const childContext = {
					files: subtask.scope,
					description: subtask.description,
				};
				const childPrefix = idPrefix ? `${idPrefix}.${subtask.id}` : subtask.id;
				const parentId = idPrefix ? `${idPrefix}.${subtask.id}` : subtask.id;
				const children = await decomposeRecursiveInternal(
					subtask.description,
					childContext,
					logger,
					config,
					currentDepth + 1,
					maxDepth,
					fileThreshold,
					childPrefix,
					decomposedParents,
				);
				// Record this parent -> children mapping so dependents can be remapped
				decomposedParents.set(parentId, children.map((c) => c.id));
				allLeaves.push(...children);
			} catch (err) {
				// On failure at deeper levels, keep the parent subtask as-is
				logger.warn("Recursive decomposition failed, keeping subtask as leaf", {
					subtaskId: subtask.id,
					error: err instanceof Error ? err.message : String(err),
				});
				allLeaves.push(...reIdSubtasks([subtask], idPrefix));
			}
		} else {
			allLeaves.push(...reIdSubtasks([subtask], idPrefix));
		}
	}

	return allLeaves;
}

/**
 * Re-prefix subtask IDs to ensure uniqueness across recursive levels.
 */
function reIdSubtasks(subtasks: SubTask[], prefix: string): SubTask[] {
	if (!prefix) return subtasks;
	return subtasks.map((st) => ({
		...st,
		id: `${prefix}.${st.id}`,
		dependencies: st.dependencies.map((d) => `${prefix}.${d}`),
	}));
}
