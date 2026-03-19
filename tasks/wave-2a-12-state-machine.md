# Task: Expand state machine to 12 DevOps-integrated states

## Priority: High | Wave: 2A (parallel with 2B, 2C, 2D)
## Depends on: Wave 1 complete

## Description
Expand the 7 generic states to 12 DevOps-integrated states with CI/PR/review substates.

## Acceptance Criteria
- States: spawning, working, pr_open, review_pending, ci_failed, changes_requested, merge_conflicts, approved, mergeable, merged, killed, archived
- Valid transitions defined for all states
- Events: start, open_pr, request_review, ci_pass, ci_fail, approve, request_changes, conflict, resolve, merge, kill, archive
- `canTransition()` and `validEvents()` updated
- All existing tests updated, new tests for PR lifecycle transitions
- SessionStatus type updated in core types

## Files to Modify
- `packages/lifecycle/src/state-machine.ts` — Rewrite transitions table
- `packages/lifecycle/src/state-machine.test.ts` — Expand tests
- `packages/core/src/types.ts` — Update SessionStatus type
