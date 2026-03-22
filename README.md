# Ultracoder

AI coding agent orchestration for teams. Spawn, manage, and coordinate multiple AI coding agents (Claude Code, Codex) running on shared infrastructure — with inline quality verification, DevOps lifecycle integration, and parallel execution.

Synthesizes the best patterns from [tcagent](https://github.com/TaisoAI/tcagent), [Longshot](https://github.com/Blastgits/longshot), [Agent Orchestrator](https://github.com/ComposioHQ/agent-orchestrator), and [pi-autoresearch](https://github.com/davebcn87/pi-autoresearch) into a unified system.

## What It Does

- **Session management** — Spawn agents in isolated workspaces via a shared pipeline, track progress through a 13-state DevOps lifecycle with state-machine-enforced transitions, archive on completion
- **Issue monitoring** — Poll GitHub for new issues, run dual-agent triage (Claude + Codex in parallel), synthesize a resolution plan, and spawn a fix agent — all automated
- **Quality pipeline** — Catch hallucinated execution claims (regex + LLM grounding), enforce tool safety policies with human approval gates, run lint/test/typecheck gates, optional AI reviewer
- **Lifecycle automation** — React to CI failures, review comments, merge conflicts, stuck agents — with configurable escalation, rate-limited auto-resume, question detection, and auto-answer
- **Parallel execution** — Recursive task decomposition (up to 3 levels), iterative re-planning from handoff reports, conflict resolution task generation, scope tracking, merge queue
- **Layered prompt builder** — Enriches raw tasks with project context, git workflow instructions, and user-defined agent rules before passing to the agent
- **Structured events** — 21-type event bus (session, PR, CI, reaction, issue, experiment, approval, merge events) with pub/sub for real-time integrations
- **Web dashboard & webhooks** — HTTP server with GitHub webhook ingestion, REST API, Server-Sent Events, and inline web dashboard for real-time session monitoring
- **Notification routing** — Priority-based routing (urgent/action/warning/info) to configurable channels (Slack, desktop)
- **Concurrency control** — Configurable `maxConcurrentSessions` limit enforced at the spawn pipeline, with input validation on all issue/PR IDs
- **Deep agent integration** — Version-pinned parser for Claude Code's stream-json output with tool_use event extraction and lightweight intent classification
- **Adaptive LLM routing** — Latency-aware endpoint selection with EMA tracking, health monitoring, and automatic probe recovery
- **Observability** — Structured NDJSON tracing, per-session cost tracking with configurable pricing, automated recovery

## Quick Start

```bash
git clone https://github.com/taiso-ai/ultracoder.git
cd ultracoder
pnpm install && pnpm build
```

Initialize in your project:

```bash
cd your-project
uc init --project-id my-project
```

Spawn an agent:

```bash
uc spawn "Fix the login bug in src/auth"
uc status                    # Check all sessions
uc status -s <id> --json     # Detailed session info
uc kill <id>                 # Kill and archive
```

## Architecture

```
ultracoder/
├── packages/
│   ├── core/            — Types, plugin registry, session manager, event bus, notification router, LLM router, utilities
│   ├── cli/             — Commander.js CLI (uc command)
│   ├── web/             — HTTP server, GitHub webhooks, REST API, SSE, web dashboard
│   ├── issue-monitor/   — GitHub issue polling, dual-agent triage, synthesis, auto-fix spawning
│   ├── quality/         — Veracity (regex + LLM), tool policy (4-tier), approval gate, gates, reviewer, pipeline
│   ├── lifecycle/       — 13-state machine, reactions, intent classifier, question detection, auto-resume
│   ├── parallel/        — Recursive decomposer, re-planner, conflict resolver, scope tracker, merge queue, reconciler
│   ├── experiment/      — Optimization loop, metric runner, confidence scoring, secondary metrics, termination
│   ├── observability/   — NDJSON tracing, cost tracking, recovery system
│   └── plugins/         — 10 plugins across 7 slots
```

### Plugin Slots (7)

| Slot | Implementations | Purpose |
|------|----------------|---------|
| runtime | tmux, process | Spawn and manage agent processes |
| agent | claude-code, codex | Build CLI commands, parse agent output streams |
| workspace | worktree, clone | Create isolated workspaces per session |
| tracker | github | Issue tracking via `gh` CLI |
| scm | github | PRs, CI status, merge operations via `gh` CLI |
| notifier | desktop, slack | Notifications (OS-native, webhook) |
| reviewer | (built-in) | Automated code review via quality package |

### Session Lifecycle (13 States)

```
spawning → working → pr_open → review_pending → approved → mergeable → merged → archived
                 ↓         ↓              ↓           ↓           ↓
              failed   ci_failed   changes_requested  ci_failed  merge_conflicts
                 ↓         ↓              ↓                         ↓
              (retry)   (resolve → working)                    (resolve → working)
```

Each state transition is validated by an exact `(from, event)` pair — semantically wrong events are rejected even if the target state would be reachable. The canonical state machine lives in `@ultracoder/core` and is enforced at the persistence layer via `SessionManager.transition(id, event)`, which atomically validates and applies transitions.

## Quality Pipeline

```
Agent Output → [Veracity Regex] → [Filesystem Cross-check] → [Tool Policy] → [Quality Gates] → [Reviewer] → Pass/Fail
```

### Veracity Checking
- **Tier 1a — Hallucination regex**: Catches execution claims ("I've created", "successfully built", "I ran the command", "all tests pass"), unverified imports, URL references, version/deprecation claims. Uses negative lookbehind to avoid false positives in code strings.
- **Tier 1b — Filesystem cross-check**: Runs `git diff` and `git status` to verify claimed files actually changed. Returns errors for claimed-but-unchanged files.
- **Tier 2 — LLM grounding**: Sends content + task context to a second agent for factual verification. Configurable via `tier: "llm"` or `"both"`. Graceful degradation on failure.

### Tool Policy (4-Tier)
- **auto** — Runs without intervention
- **evaluate** — Heuristic rules engine checks network boundaries (blocks RFC 1918/link-local IPs, requires HTTPS), scope containment (blocks writes outside workspace), and resource limits (max file size, max files modified)
- **human** — Requires human approval
- **blocked** — Cannot run (secrets files, destructive operations)

### Quality Gates
Auto-detects and runs `lint`, `test`, `typecheck` in parallel with 5-minute timeout per gate.

## Issue Monitoring

Automatically triage and fix GitHub issues with dual-agent assessment:

```yaml
issueMonitor:
  enabled: true
  pollIntervalMs: 60000
  filter:
    labels: ["bug", "uc:autofix"]
    excludeLabels: ["wontfix", "question"]
  maxEffort: medium
  maxConcurrentSpawns: 3
```

When enabled, the monitor polls for new issues matching the filter, runs two independent assessments (Claude Opus 4.6 + Codex), posts both as issue comments, synthesizes a resolution plan, and spawns a coding agent to implement the fix as a PR for human review.

## Configuration

```yaml
projectId: my-project
rootPath: .
defaultBranch: main

session:
  agent:
    type: claude-code
    timeout: 3600
  quality:
    veracity:
      enabled: true
      tier: regex          # regex, llm, or both
    toolPolicy:
      enabled: true
      defaultTier: evaluate
      evaluateRules:
        maxFileSize: 1048576    # 1MB
        maxFilesModified: 100
        maxSubprocessMs: 300000 # 5 min
    gates:
      lint: true
      test: true
      typecheck: true
    reviewer:
      enabled: false
  reactions:
    ci_fail:
      maxRetries: 2
      escalateAfterMs: 1800000   # 30 min
    conflict:
      maxRetries: 1
      escalateAfterMs: 900000    # 15 min
    stuck:
      maxRetries: 1
      escalateAfterMs: 600000    # 10 min
  maxConcurrent: 4
  maxConcurrentSessions: 10    # Global spawn limit
  autoResume: true
  cooldownSeconds: 30
  maxResumes: 20               # Max total auto-resumes
  resumeCooldownMs: 300000     # 5 min between resumes

workspace:
  strategy: worktree

plugins:
  runtime:
    package: "@ultracoder/plugin-runtime-tmux"
  agent:
    package: "@ultracoder/plugin-agent-claude-code"
  workspace:
    package: "@ultracoder/plugin-workspace-worktree"

notifications:
  desktop: true
  slack:
    enabled: false
    webhook: https://hooks.slack.com/services/...
  routing:
    urgent: [slack, desktop]
    action: [desktop]
    warning: [desktop]
    info: []

web:
  enabled: false
  port: 3100
  host: localhost
  webhookSecret: ~             # HMAC secret for GitHub webhook verification
```

Config search order: explicit `--config` path → project directory → `~/.ultracoder/`

## CLI Commands

| Command | Description |
|---------|-------------|
| `uc init` | Initialize ultracoder.yaml in current project |
| `uc spawn <task>` | Spawn a new agent session |
| `uc start <id>` | Resume a spawning or failed session |
| `uc stop <id>` | Gracefully pause a working session |
| `uc send <id> <message>` | Send a message to a working session |
| `uc status` | List all sessions |
| `uc status -s <id> --json` | Detailed session info as JSON |
| `uc kill <id>` | Kill runtime, archive session |
| `uc batch-spawn <file>` | Spawn sessions from a task file |
| `uc watch <id>` | Stream live session output |
| `uc logs <id>` | View session logs |
| `uc dashboard` | Live terminal dashboard with session status, costs, warnings |
| `uc monitor start` | Start polling GitHub for new issues and auto-triaging |
| `uc monitor status` | Show monitored issues and their pipeline states |
| `uc monitor assess <id>` | Manually trigger dual assessment for an issue |
| `uc approvals` | List pending tool call approvals |
| `uc approve <id>` | Approve a pending tool call |
| `uc deny <id> [reason]` | Deny a pending tool call |
| `uc web start` | Start the web dashboard and webhook server |
| `uc web stop` | Stop the web server |
| `uc cleanup` | Remove old terminal sessions (default: >7 days) |
| `uc cleanup --all` | Remove all terminal sessions |
| `uc doctor` | Check system health and dependencies |

## Development

```bash
pnpm install        # Install dependencies
pnpm build          # Build all 21 packages
pnpm test           # Run 840+ tests across 40 suites
pnpm lint           # Check 107+ files with Biome
pnpm lint:fix       # Auto-fix lint issues
```

### Requirements

- Node.js 20+
- pnpm 9+
- tmux (for tmux runtime plugin)
- git (for worktree workspace plugin)
- gh CLI (for GitHub tracker/SCM plugins)
- Claude Code CLI or Codex CLI (agent to orchestrate)

### Monorepo Structure

21 packages, 840+ tests, all managed with pnpm workspaces + Turborepo:

| Package | Tests | Description |
|---------|-------|-------------|
| `@ultracoder/core` | 160 | Types, schemas, state machine, spawn pipeline, prompt builder, event bus, notification router, adaptive LLM router, plugin registry, config, session manager, paths, logger, utilities |
| `@ultracoder/cli` | 4 | Commander.js CLI with 17 commands |
| `@ultracoder/web` | 20 | HTTP server, GitHub webhooks (HMAC verification), REST API, SSE real-time events, inline web dashboard |
| `@ultracoder/issue-monitor` | 69 | GitHub issue polling, dual-agent triage (Claude + Codex), synthesis, auto-fix spawning |
| `@ultracoder/quality` | 118 | Veracity (regex + LLM + filesystem), tool policy (4-tier), approval gate, gates, pipeline |
| `@ultracoder/lifecycle` | 168 | 13-state machine, reactions, intent classifier, question detection & auto-answer, activity detection, rate-limited auto-resume |
| `@ultracoder/parallel` | 87 | Recursive task decomposer, re-planner, conflict resolver, scope tracker, merge queue, reconciler, finalization |
| `@ultracoder/experiment` | 54 | Experiment runner, metric evaluation, MAD-based confidence scoring, secondary metrics, termination checks |
| `@ultracoder/observability` | 25 | NDJSON tracing, cost tracking, recovery |
| 10 plugins | 135 | Runtime, agent, workspace, tracker, SCM, notifier implementations |

## Documentation

- [Getting Started](docs/getting-started.md) — Installation, first session, walkthrough
- [Configuration](docs/configuration.md) — Full YAML config reference
- [Plugins](docs/plugins.md) — All plugins, custom plugin guide
- [Quality Pipeline](docs/quality-pipeline.md) — Veracity, tool policy, gates, reviewer
- [Lifecycle](docs/lifecycle.md) — 13-state machine, reactions, escalation, auto-resume
- [Parallel Execution](docs/parallel-execution.md) — Decomposition, scope tracking, merge queue
- [Issue Monitoring](docs/issue-monitoring.md) — Dual-agent triage, synthesis, auto-fix pipeline
- [Observability](docs/observability.md) — Tracing, cost tracking, recovery
- [Architecture](docs/architecture.md) — Design principles, package relationships, data flow

## License

MIT
