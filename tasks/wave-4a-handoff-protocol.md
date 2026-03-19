# Task: Add structured handoff protocol with metrics

## Priority: Medium | Wave: 4A
## Depends on: Wave 1D (stream parser for metrics extraction)

## Description
Handoff currently only transfers file ownership. Add structured response with metrics.

## Acceptance Criteria
- New `HandoffReport` interface: summary, diff, filesChanged, concerns, suggestions, metrics (linesAdded, linesRemoved, tokensUsed, toolCallCount, durationMs)
- `completeSession()` function generates a HandoffReport from session data
- Extracts metrics from agent activity log and git diff
- HandoffReport stored as JSONL in session directory
- Tests with sample session data

## Files to Create/Modify
- `packages/parallel/src/handoff.ts` — New file with HandoffReport type and generation
- `packages/parallel/src/handoff.test.ts` — Tests
- `packages/parallel/src/index.ts` — Export
