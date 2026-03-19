# Task: Add time-based escalation and retry counts to reactions

## Priority: High | Wave: 2C (parallel with 2A, 2B, 2D)
## Depends on: Wave 1 complete

## Description
Reactions currently have no time-based escalation or retry tracking. Add timestamps, configurable thresholds, and retry counts.

## Acceptance Criteria
- `ReactionConfig` type with per-trigger settings:
  - `ci_fail`: maxRetries (default 2), escalateAfterMs (default 30 min)
  - `changes_requested`: escalateAfterMs (default 30 min)
  - `merge_conflicts`: escalateAfterMs (default 15 min)
  - `stuck`: escalateAfterMs (default 10 min)
- `evaluateReaction()` accepts session metadata with `firstDetectedAt` and `retryCount` per trigger
- If retryCount >= maxRetries → escalate action
- If now - firstDetectedAt > escalateAfterMs → escalate action
- Reaction config loadable from ultracoder.yaml `session.reactions`
- Worker stores `firstDetectedAt` and `retryCount` in session metadata on trigger
- Tests for escalation thresholds and retry limits

## Files to Modify
- `packages/lifecycle/src/reactions.ts` — Add ReactionConfig, escalation logic
- `packages/lifecycle/src/reactions.test.ts` — New tests
- `packages/core/src/schemas.ts` — Add reaction config to SessionConfigSchema
