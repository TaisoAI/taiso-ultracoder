# Task: Build heuristic rules engine for tool policy "evaluate" tier

## Priority: Immediate | Wave: 1C (parallel with 1A, 1B, 1D)

## Description
The "evaluate" tier currently has no evaluation logic. Build a heuristic rules engine with three categories: network boundary rules, scope containment rules, and resource limit rules.

## Acceptance Criteria
- New `evaluateHeuristic(tool: string, args: string[], context: EvaluateContext)` function
- Three rule categories:
  1. **Network boundary**: block requests to RFC 1918/link-local IPs, restrict to known API hosts, require HTTPS
  2. **Scope containment**: agent can only modify files in its assigned scope (paths list), block writes outside worktree
  3. **Resource limits**: max file size for writes (configurable, default 1MB), max files modified per session (default 100), max subprocess runtime (default 5min)
- `EvaluateContext` includes: sessionId, workspacePath, assignedScope (file list), resourceUsage (files modified, bytes written)
- Returns `{ allowed: boolean, reason: string, category: string }`
- Rules are configurable in ultracoder.yaml under `session.quality.toolPolicy.evaluateRules`
- Tests for each rule category

## Files to Create/Modify
- `packages/quality/src/tool-policy.ts` — Add evaluateHeuristic() and rule types
- `packages/quality/src/tool-policy.test.ts` — Tests for all 3 rule categories
- `packages/core/src/schemas.ts` — Add evaluate rules to QualityConfigSchema

## Dependencies
None — can run in parallel with other Wave 1 tasks.
