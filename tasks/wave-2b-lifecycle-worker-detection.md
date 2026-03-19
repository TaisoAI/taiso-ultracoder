# Task: Add PR/CI/review detection to lifecycle worker

## Priority: High | Wave: 2B (parallel with 2A, 2C, 2D)
## Depends on: Wave 1 complete (needs expanded AgentActivity types)

## Description
The worker currently only checks activity + stuck. Add 4 more detection steps: runtime alive, PR state, CI checks, review decisions. Batch GitHub queries into single GraphQL call.

## Acceptance Criteria
- Worker `checkSession()` performs 6 detection steps:
  1. Runtime alive (via runtime plugin `isAlive()`)
  2. Agent activity (existing)
  3. PR state (via SCM plugin `getPRStatus()`)
  4. CI checks (via SCM plugin `getCIStatus()`)
  5. Review decisions (from PR status reviewDecision field)
  6. Stuck detection (existing)
- Each detection step triggers appropriate state transitions
- Session transitions to ci_failed, changes_requested, etc. based on detection
- Worker catches and logs errors per-step (one failing step doesn't block others)
- Tests with mocked plugins

## Files to Modify
- `packages/lifecycle/src/worker.ts` — Expand checkSession() with 6 steps
- `packages/lifecycle/src/worker.test.ts` — New test file with mocked deps
