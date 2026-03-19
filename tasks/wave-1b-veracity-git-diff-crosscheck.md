# Task: Add git-diff-based filesystem cross-check to veracity

## Priority: Immediate | Wave: 1B (parallel with 1A, 1C, 1D)

## Description
After an agent claims completion, verify that files actually changed using `git diff` and `git status` in the worktree. This is the "ground truth" layer of veracity checking.

## Acceptance Criteria
- New function `checkVeracityFilesystem(workspacePath: string, claimedFiles?: string[])` in veracity.ts
- Runs `git diff --name-only` and `git status --porcelain` in the workspace
- If claimedFiles provided: verify each claimed file appears in the diff
- If no claimedFiles: just report what actually changed (informational)
- Returns VeracityFinding[] with severity "error" for claimed-but-unchanged files
- Integrated into the quality pipeline as a stage between veracity regex and gates
- Tests using temp git repos with actual commits

## Files to Create/Modify
- `packages/quality/src/veracity.ts` — Add `checkVeracityFilesystem()` function
- `packages/quality/src/veracity.test.ts` — Add tests with temp git repos
- `packages/quality/src/pipeline.ts` — Wire filesystem check into pipeline

## Dependencies
None — can run in parallel with other Wave 1 tasks.
