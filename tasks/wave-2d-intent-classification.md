# Task: Add lightweight intent classification

## Priority: High | Wave: 2D (parallel with 2A, 2B, 2C)
## Depends on: Wave 1D (Claude Code stream parser)

## Description
Classify agent intent based on tool usage patterns. No LLM needed — pure heuristics.

## Acceptance Criteria
- New `classifyIntent(recentEvents: AgentActivity[])` function
- Intent types: "exploring", "planning", "implementing", "testing", "debugging", "reviewing", "committing", "idle"
- Classification rules:
  - Many Read+Grep+Glob → "exploring"
  - Write+Edit predominant → "implementing"
  - Bash with test/pytest/vitest → "testing"
  - Bash with git commands → "committing"
  - Read after error events → "debugging"
  - No activity → "idle"
- Returns `{ intent: string, confidence: number, evidence: string }`
- Window-based: looks at last N events (default 10) for classification
- Integrated into ActivitySummary type
- Tests for each intent classification

## Files to Create/Modify
- `packages/lifecycle/src/intent-classifier.ts` — New file
- `packages/lifecycle/src/intent-classifier.test.ts` — Tests
- `packages/lifecycle/src/activity-detector.ts` — Integrate into ActivitySummary
- `packages/lifecycle/src/index.ts` — Export new module
