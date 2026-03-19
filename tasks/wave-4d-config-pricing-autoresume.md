# Task: Config-driven pricing + hybrid auto-resume + CLI commands

## Priority: Lower | Wave: 4D (parallel with 4A, 4B, 4C)

## Description
Bundle of polish items: move pricing to config, implement hybrid auto-resume, add watch/logs CLI commands.

## Acceptance Criteria
- **Config-driven pricing**: Move hardcoded PRICING map to ultracoder.yaml `pricing` section. Ship defaults, allow user overrides. `calculateCost()` reads from config.
- **Hybrid auto-resume**: On context exhaustion, new session gets (1) original task, (2) git diff of work done via `git diff main...HEAD`, (3) structured progress summary written to `.ultracoder/progress.md` before session ends.
- **`uc watch` command**: Continuously refreshes table of sessions (like `kubectl get pods -w`). Polls every 2s.
- **`uc logs` command**: `uc logs <id>` tails the session's activity JSONL. `uc logs <id> -f` follows.
- Tests for each feature

## Files to Modify
- `packages/observability/src/cost-tracker.ts` — Read pricing from config
- `packages/core/src/schemas.ts` — Add pricing config schema
- `packages/lifecycle/src/auto-resume.ts` — Implement hybrid resume context
- `packages/cli/src/commands/watch.ts` — New command
- `packages/cli/src/commands/logs.ts` — New command
- `packages/cli/src/index.ts` — Register new commands
