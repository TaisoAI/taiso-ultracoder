# Ultracoder: Task Breakdown and Build Plan

## Context

The repo at `/Users/swong/Dev/taiso-ultracoder` synthesizes 4 open-source AI coding agent projects (tcagent, Longshot, Agent Orchestrator, pi-autoresearch) into a unified TypeScript system for teams running shared infrastructure.

**Goal**: 31 discrete tasks across 5 phases, built as a pnpm monorepo with turborepo.

## Monorepo Structure

```
ultracoder/
├── packages/
│   ├── core/           (@ultracoder/core)          — types, plugin registry, session mgr, config
│   ├── cli/            (@ultracoder/cli)           — Commander.js CLI
│   ├── quality/        (@ultracoder/quality)       — veracity, tool policy, gates, reviewer
│   ├── lifecycle/      (@ultracoder/lifecycle)     — state machine, reactions, auto-resume
│   ├── parallel/       (@ultracoder/parallel)      — decomposer, merge queue, reconciler
│   ├── observability/  (@ultracoder/observability) — tracing, metrics, cost, recovery
│   └── plugins/
│       ├── runtime-tmux/       runtime-process/
│       ├── agent-claude-code/  agent-codex/
│       ├── workspace-worktree/ workspace-clone/
│       ├── tracker-github/     scm-github/
│       └── notifier-desktop/   notifier-slack/
```

---

## Task List (31 tasks)

### Phase 0: Scaffolding

| Task | Description | Deps | Package | Status |
|------|-------------|------|---------|--------|
| 0 | Project scaffolding (git, pnpm, tsconfig, turbo, biome, CI, package shells) | — | root | DONE |

### Phase 1: Foundation

| Task | Description | Deps | Package | Status |
|------|-------------|------|---------|--------|
| 1 | Core types & interfaces (plugin slots, session, config, Deps, Zod schemas) | 0 | core | DONE |
| 2 | Atomic write, key-value store, JSONL utilities | 0 | core | DONE |
| 3 | Paths (hash-namespaced dirs) + structured logger | 0 | core | DONE |
| 4 | Plugin registry (7-slot, dynamic import, graceful degradation) | 1,3 | core | DONE |
| 5 | Configuration system (Zod YAML, search order, per-project overrides) | 1,3 | core | DONE |
| 6 | Session manager (CRUD, atomic writes, archive-on-kill) | 1,2,3 | core | DONE |
| 7 | CLI skeleton (Commander.js: init/spawn/send/status/kill/cleanup/doctor) | 4,5,6 | cli | DONE |
| 8 | Runtime plugins (tmux + process) | 1,4 | plugins | DONE |
| 9 | Agent plugins (claude-code + codex) | 1,4,8 | plugins | DONE |
| 10 | Workspace plugins (worktree + clone) | 1,4 | plugins | DONE |
| 11 | Tracker + SCM plugins (GitHub issues, PRs, CI, reviews) | 1,4 | plugins | DONE |
| 12 | Notifier plugins (desktop + slack) | 1,4 | plugins | DONE |
| 13 | E2E spawn integration test | 4-10 | core | DONE |

### Phase 2: Quality Pipeline

| Task | Description | Deps | Package | Status |
|------|-------------|------|---------|--------|
| 14 | Veracity checking (Tier 1 regex + Tier 2 LLM grounding) | 0,1 | quality | DONE |
| 15 | Tool policy (4-tier approval: auto/evaluate/human/blocked) | 0,1 | quality | DONE |
| 16 | Quality gates (auto-detect lint/test/typecheck, parallel run) | 0,1,3 | quality | DONE |
| 17 | Reviewer agent (2nd AI instance, read-only, structured verdicts) | 1,9 | quality | DONE |
| 18 | Composable quality pipeline (wire stages, configurable per-project) | 14-17 | quality | DONE |

### Phase 3: Lifecycle & Reactions

| Task | Description | Deps | Package | Status |
|------|-------------|------|---------|--------|
| 19 | Session state machine (transitions, validation, events) | 1,6 | lifecycle | DONE |
| 20 | Agent activity detection (JSONL parsing, idle/active/completed) | 1,2,9 | lifecycle | DONE |
| 21 | Reaction engine (CI fail, review, conflicts, stuck → actions) | 19,11 | lifecycle | DONE |
| 22 | Lifecycle worker (30s polling, PID management, graceful shutdown) | 19-21,11 | lifecycle | DONE |
| 23 | Auto-resume (context exhaustion → cooldown → fresh session) | 6,9,20 | lifecycle | DONE |

### Phase 4: Parallel Execution

| Task | Description | Deps | Package | Status |
|------|-------------|------|---------|--------|
| 24 | Task decomposition (recursive LLM, scope validation) | 1,3 | parallel | DONE |
| 25 | Scope tracker + handoff protocol | 1 | parallel | DONE |
| 26 | Merge queue (serial priority, rebase-retry, strategy fallback) | 1,10,3 | parallel | DONE |
| 27 | Reconciler + finalization (health sweeps, corrective loops) | 16,24,26 | parallel | DONE |

### Phase 5: Observability & Advanced

| Task | Description | Deps | Package | Status |
|------|-------------|------|---------|--------|
| 28 | Structured tracing (NDJSON spans) + aggregate metrics | 1,2,3 | observability | DONE |
| 29 | Cost tracking (per-session budgets, pricing models) | 1,28 | observability | DONE |
| 30 | Recovery system (scan/validate/act/report, dry-run) | 6,22 | observability | DONE |
| 31 | Orchestrator-as-agent (recursive agent management prompt) | 7,22 | core | DONE |

---

## Parallelization Waves

Tasks within each wave ran concurrently (different files/packages):

- **Wave 1**: Tasks 1, 2, 3 (after 0)
- **Wave 2**: Tasks 4, 5, 6 (after Wave 1)
- **Wave 3**: Tasks 7, 8, 9, 10, 11, 12 (after Wave 2)
- **Wave 4**: Tasks 13, 14, 15, 16 (after Wave 3)
- **Wave 5**: Tasks 17, 18, 19, 20, 24, 25, 28
- **Wave 6**: Tasks 21, 22, 23, 26, 27, 29, 30, 31

---

## Build Results

### Packages (16 total)

| Package | Source Files | Tests | Description |
|---------|-------------|-------|-------------|
| @ultracoder/core | 12 | 38 | Types, schemas, plugin registry, config, session manager, paths, logger, atomic writes, KV store, JSONL |
| @ultracoder/cli | 10 | 1 | Commander.js CLI: init/spawn/send/status/kill/cleanup/doctor |
| @ultracoder/quality | 6 | 9 | Veracity checking, tool policy (4-tier), quality gates, reviewer, composable pipeline |
| @ultracoder/lifecycle | 6 | 9 | State machine, activity detection, reactions, lifecycle worker, auto-resume |
| @ultracoder/parallel | 6 | 9 | Task decomposer, scope tracker, merge queue, reconciler |
| @ultracoder/observability | 4 | 4 | Tracing (NDJSON spans), cost tracking, recovery system |
| 10 plugins | 20 | 37 | runtime-tmux, runtime-process, agent-claude-code, agent-codex, workspace-worktree, workspace-clone, tracker-github, scm-github, notifier-desktop, notifier-slack |

### Verification

```
pnpm build   → 16/16 packages compile
pnpm test    → 107 tests passing
pnpm lint    → 79 files checked, 0 errors
```
