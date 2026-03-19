# Task: Wire reconciler to real tsc+build+test execution

## Priority: Medium | Wave: 3D (parallel with 3A, 3B, 3C, 3E)
## Depends on: Quality gates module (already implemented)

## Description
Reconciler is a callback abstraction. Wire it to actually run tsc, build, and test commands on the merged codebase.

## Acceptance Criteria
- Reconciler uses quality gates module (`runGates()`) for build/test execution
- `reconcile()` accepts project path and runs full gate suite on it
- Adaptive intervals: faster sweeps on failure (60s), slower after 3 consecutive green sweeps (5min)
- Max 5 fix tasks per sweep (returns list of fix descriptions)
- Deduplication: tracks recently-fixed file scopes to prevent duplicate fix tasks
- Health check function implemented (not just callback): checks git status, build, test
- Tests with mocked gate results

## Files to Modify
- `packages/parallel/src/reconciler.ts` — Replace callback with real execution
- `packages/parallel/src/reconciler.test.ts` — New tests
