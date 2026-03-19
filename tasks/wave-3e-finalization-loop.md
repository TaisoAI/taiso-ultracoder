# Task: Build finalization loop (3 corrective sweeps)

## Priority: Medium | Wave: 3E (parallel with 3A, 3B, 3C, 3D)
## Depends on: Wave 3C (merge executor), Wave 3D (reconciler)

## Description
After all parallel agents complete, run corrective cycles to ensure clean state.

## Acceptance Criteria
- New `finalize(deps, config)` function in parallel package
- Runs up to 3 corrective cycles:
  1. Drain merge queue (process all pending entries)
  2. Run reconciler sweep on merged result
  3. If reconciler finds failures: spawn fix agents for each (max 5)
  4. Wait for fix agents to complete
  5. Repeat from step 1
- Exits early if reconciler sweep is green
- Returns FinalizationResult: { cycles, fixesSpawned, finalHealth }
- Configurable max cycles (default 3)
- Tests with mocked merge queue and reconciler

## Files to Create/Modify
- `packages/parallel/src/finalization.ts` — New file
- `packages/parallel/src/finalization.test.ts` — Tests
- `packages/parallel/src/index.ts` — Export
