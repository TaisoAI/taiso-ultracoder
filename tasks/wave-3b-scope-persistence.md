# Task: Persist scope tracker state to JSONL

## Priority: Medium | Wave: 3B (parallel with 3A, 3C, 3D, 3E)
## Depends on: None (uses existing JSONL utilities)

## Description
Scope tracker is in-memory only. Persist assignments to JSONL so state survives orchestrator restarts.

## Acceptance Criteria
- ScopeTracker accepts a `persistPath` option
- Every `acquire()` and `release()` appends a JSONL event: `{ type: "acquire"|"release", sessionId, files, timestamp }`
- Constructor accepts optional `persistPath` and reconstructs state from log on creation
- `reconstructScope(logPath)` replays JSONL to rebuild Map state
- Handoff events also persisted
- Tests: write events, reconstruct, verify state matches
- Backward compatible: if no persistPath, behaves as before (in-memory only)

## Files to Modify
- `packages/parallel/src/scope-tracker.ts` — Add persistence
- `packages/parallel/src/scope-tracker.test.ts` — Add persistence tests
