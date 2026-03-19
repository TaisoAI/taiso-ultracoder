# Task: Implement task decomposition via agent CLI delegation

## Priority: Medium | Wave: 3A (parallel with 3B, 3C, 3D, 3E)
## Depends on: Wave 1D (stream parser), Wave 2A (state machine)

## Description
Replace the stub decomposer with real LLM-powered decomposition. Delegate to agent CLI — spawn a lightweight Claude Code session with a decomposition prompt.

## Acceptance Criteria
- `decomposeTask()` spawns a short-lived agent session with a structured decomposition prompt
- Prompt includes: task description, file tree, project context
- Agent output is parsed into SubTask[] with: id, title, description, dependencies, scope (file list), priority
- Recursive decomposition: tasks with scope >= 4 files are sub-decomposed (max depth 3, max 10 subtasks per batch)
- Scope validation: no two subtasks share files in their scope
- Returns executionOrder as topologically-sorted waves
- Fallback: if decomposition fails, return single task (current behavior)
- Tests with mocked agent CLI output

## Files to Modify
- `packages/parallel/src/decomposer.ts` — Replace stub with real implementation
- `packages/parallel/src/decomposer.test.ts` — New tests
