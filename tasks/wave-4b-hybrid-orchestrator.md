# Task: Implement hybrid orchestrator (deterministic + LLM)

## Priority: Lower | Wave: 4B
## Depends on: Wave 2 (lifecycle), Wave 3 (parallel)

## Description
Deterministic loop for routine coordination. LLM orchestrator (via agent CLI delegation) only for ambiguous decisions.

## Acceptance Criteria
- New `Orchestrator` class in core package
- Deterministic loop handles: session polling, reaction execution, merge queue processing, reconciler sweeps
- LLM delegation for: task decomposition decisions, conflict resolution strategy, priority rebalancing
- LLM invoked by spawning lightweight agent session with structured prompt
- `uc orchestrate` CLI command starts the orchestrator loop
- Configurable: which decisions use LLM vs deterministic
- Tests with mocked agent sessions

## Files to Create/Modify
- `packages/core/src/orchestrator.ts` — New Orchestrator class
- `packages/core/src/orchestrator.test.ts` — Tests
- `packages/cli/src/commands/orchestrate.ts` — New CLI command
