# Task: Implement git merge execution in merge queue

## Priority: Medium | Wave: 3C (parallel with 3A, 3B, 3D, 3E)
## Depends on: Wave 2A (state machine for session state updates)

## Description
Merge queue is data-structure only. Add actual git operations: merge execution with strategy fallback, conflict detection, and kill-rebase-respawn on failure.

## Acceptance Criteria
- New `MergeExecutor` class that processes the merge queue
- `executeMerge(entry)` performs:
  1. Checkout target branch (default branch)
  2. Attempt merge with configured strategy (squash → rebase → merge, configurable)
  3. If conflict: kill the agent session, rebase the branch, respawn fresh agent
  4. If success: run quality gates on merged result, advance queue
  5. Max 2 retry attempts per entry before escalating
- Uses workspace plugin for git operations (execFile for git commands)
- `ensureCleanState()` in finally blocks (git reset, clean)
- MergeResult type: merged | conflict | failed | retry
- Tests with temp git repos and artificial conflicts

## Files to Create/Modify
- `packages/parallel/src/merge-executor.ts` — New file with MergeExecutor
- `packages/parallel/src/merge-executor.test.ts` — Tests
- `packages/parallel/src/merge-queue.ts` — Wire executor into queue processing
- `packages/parallel/src/index.ts` — Export new module
