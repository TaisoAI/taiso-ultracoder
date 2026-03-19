# Coding Agent Synthesis: Unified Architecture Plan

*Combining the best of tcagent, Longshot, Agent Orchestrator, and pi-autoresearch into one system.*
*All four codebases verified against source.*

---

## Overview

AI coding agents — tools like Claude Code, OpenAI Codex, and Aider that write and modify code autonomously — are becoming a core part of software development. But running these agents effectively at scale introduces coordination problems that the agents themselves don't solve: How do you verify an agent didn't hallucinate completing a task? How do you run multiple agents in parallel without merge conflicts? How do you automatically handle CI failures and code review feedback? How do you keep an agent working when it hits context window limits?

Four open-source projects have independently tackled different facets of this problem. Each makes a different bet about what matters most:

- **tcagent** bets on *correctness* — verifying every agent action inline
- **Longshot** bets on *speed* — parallelizing 50 agents and merging their work
- **Agent Orchestrator** bets on *coordination* — integrating agents with the DevOps lifecycle (CI, reviews, merges)
- **pi-autoresearch** bets on *persistence* — keeping an agent running indefinitely across context boundaries

This document analyzes what each project does uniquely, then synthesizes their best patterns into an actionable plan for a new system that is correct, fast, coordinated, and persistent.

---

## The Four Projects

### tcagent — The Quality Inspector

**Repository**: [github.com/TaisoAI/tcagent](https://github.com/TaisoAI/tcagent)
**Language**: Python 3.12 | **Version**: 0.15.1 | **Tests**: 726 unit tests, 97% coverage

tcagent is an *autonomous coding supervisor* that wraps any CLI coding agent (Claude Code, Aider, or custom) in a quality-enforcement layer. The user never interacts with the coding agent directly — tcagent intercepts the agent's output stream, checks it for hallucinations, enforces tool approval policies, runs quality gates (lint/test/typecheck), and optionally consults a second AI reviewer before advancing.

The core abstraction is a **7-step checklist** (understand → plan → implement → test → lint → review → commit) driven by a supervisor loop. Each step is verified before advancing to the next. On failure, the step retries with the error context injected into the agent's prompt.

tcagent stores every conversation turn, tool approval decision, and veracity check result in a SQLite database, creating a full audit trail. It also provides an interactive REPL (terminal UI) and a web dashboard with WebSocket for real-time monitoring.

**Why it matters**: tcagent is the only system that actively detects when an agent *claims* to have done something it didn't actually do (hallucinated execution), and the only one with a formal tool approval workflow where dangerous operations require human sign-off.

### Longshot — The Parallel Pipeline

**Repository**: [github.com/Blastgits/longshot](https://github.com/Blastgits/longshot)
**Language**: TypeScript + Python | **Version**: 0.1.0

Longshot (formerly AgentSwarm) takes a single natural-language prompt — like "Build a Minecraft clone" — and decomposes it into hundreds of granular tasks that run in parallel across up to 50 isolated cloud sandboxes (Modal containers). A central planner maintains a persistent LLM conversation, dispatching tasks to ephemeral workers and replanning as results come back.

The system is **fully stateless** — all state lives in Git (branches = work-in-progress, commits = completed work, merges = integrated work). Workers communicate with the planner exclusively through structured "handoff" JSON reports.

The self-healing merge pipeline is Longshot's most distinctive feature: a serial merge queue with automatic rebase-and-retry on conflicts, a reconciler that periodically runs build/test sweeps and spawns fix tasks for failures, and a finalization phase that runs 3 corrective cycles after the planning loop completes.

Longshot deploys its own LLM (GLM-5-FP8 on 8x NVIDIA B200 GPUs via SGLang) but supports any OpenAI-compatible endpoint. The LLM client features weighted round-robin routing with latency-adaptive rebalancing.

**Why it matters**: Longshot is the only system that seriously tackles the merge problem — what happens when 50 agents edit the same codebase simultaneously. Its scope tracker, merge queue, reconciler, and finalization loop form a layered defense against integration failures.

### Agent Orchestrator — The Fleet Manager

**Repository**: [github.com/ComposioHQ/agent-orchestrator](https://github.com/ComposioHQ/agent-orchestrator)
**Language**: TypeScript (pnpm monorepo)

Agent Orchestrator (`ao`) manages fleets of AI coding agents working on different issues in the same codebase. Each issue gets its own isolated session: a git worktree, a tmux session, and an AI agent. A background lifecycle worker polls every 30 seconds, detects state changes (CI passed, review requested, agent stuck), and executes configurable reactions — automatically sending CI failure output to the agent, forwarding review comments, or escalating to a human via Slack/desktop notification.

The entire system is built around a **7-slot plugin architecture**: Runtime (tmux/process), Agent (Claude Code/Codex/Aider/OpenCode), Workspace (worktree/clone), Tracker (GitHub/Linear/GitLab), SCM (GitHub/GitLab), Notifier (Slack/desktop/Composio/webhook), Terminal (iTerm2/web). Every external integration is swappable.

The most philosophically interesting design: the supervisory orchestrator is itself an AI agent (Claude Code) that uses the `ao` CLI to spawn and manage worker sessions, creating a recursive agent-manages-agents pattern.

**Why it matters**: Agent Orchestrator is the only system that integrates with the full DevOps lifecycle — CI check runs, code review decisions, merge readiness assessment, branch protection rules. It treats agent management as a fleet operations problem, not a per-agent quality problem.

### pi-autoresearch — The Infinite Loop

**Repository**: [github.com/davebcn87/pi-autoresearch](https://github.com/davebcn87/pi-autoresearch)
**Language**: TypeScript (Pi extension) | **Size**: ~1630 lines in one file + one SKILL.md

pi-autoresearch is an extension for the Pi Coding Agent that runs an autonomous optimization loop: the agent makes a code change, runs a benchmark, measures a metric, and keeps the change only if the metric improved — then repeats forever. The entire system is two files: `index.ts` (domain-agnostic infrastructure) and `SKILL.md` (domain-specific knowledge injected into the LLM's context).

The key insight is that **there is no loop in the code**. The loop is emergent behavior from three mechanisms: (a) the skill tells the LLM "LOOP FOREVER, NEVER STOP", (b) the extension injects autoresearch instructions into the system prompt on every agent turn, (c) when the agent hits context window limits, an auto-resume handler starts a fresh agent that reads persistent state files and continues where the previous one left off.

State is append-only JSONL. On every session start, `reconstructState()` replays the entire log to rebuild in-memory state. This means the system survives any crash — power failure, OOM kill, context exhaustion — with zero data loss.

**Why it matters**: pi-autoresearch solves the context window problem that kills long-running agent tasks. Its auto-resume mechanism, append-only persistence, and emergent loop pattern enable truly indefinite agent execution without the fragility of maintaining a long-lived process.

---

## The Four Projects at a Glance

| | **tcagent** | **Longshot** | **Agent Orchestrator** | **pi-autoresearch** |
|---|---|---|---|---|
| **Core idea** | Supervisor wrapper for one agent | Parallel pipeline for 50 agents | Fleet manager for N agents | Autonomous experiment loop |
| **Bet** | Correctness through inline verification | Speed through massive parallelism | Coordination through DevOps lifecycle | Persistence through emergent LLM behavior |
| **Agent model** | Single sequential agent, intercepted | Ephemeral one-shot workers | Independent sessions, externally supervised | Single agent in infinite loop |
| **State** | SQLite WAL (full audit trail) | Git only (stateless) | Flat files (atomic writes) | JSONL (append-only, replay on restart) |
| **Quality** | Inline: veracity + reviewer + gates | Eventual: reconciler + finalization | External: CI + human reviewers | Metric-gated: keep only if improved |
| **Self-healing** | Retry same agent with context | Spawn new agents to fix | Reaction engine (CI fail → send to agent) | LLM decides to try again |
| **Language** | Python 3.12 | TypeScript + Python | TypeScript | TypeScript (Pi extension) |
| **Maturity** | v0.15.1, 726 tests, 97% coverage | v0.1.0, comprehensive DI test suite | Active development, 22 integration tests | v1.0.0, 2 files, ~1630 lines |

---

## What Each Uniquely Contributes

The sections below identify capabilities that exist in **only one** of the four projects. These are the patterns worth extracting for a unified system.

### tcagent: Per-Task Correctness Infrastructure

1. **Two-tier veracity checking** — Tier 1 (regex, zero-cost): catches hallucinated execution claims like "I've successfully created", "I ran the command", "all files in place". Tier 2 (LLM): sends context + response to a grounding checker that identifies unsubstantiated claims. This is the only system that actively detects when an agent says it did something it didn't.

2. **Tool policy with 4-tier approval** — `auto_approve` (Read, Grep), `evaluate` (Write, Edit — LLM decides), `require_human` (git push — blocks until /approve), `blocked` (sudo, rm -rf — terminates agent). Uses glob-pattern matching against tool name + arguments. Thread-safe ApprovalGate with 300s timeout.

3. **Reviewer agent** — Second Claude Code instance with read-only tools. Reviews the primary agent's work and issues verdicts: ON_TRACK, ISSUES_FOUND, NEEDS_USER. Integrated at each checklist step, not as a post-hoc check.

4. **Intent classification pipeline** — Two-pass extraction (heuristic + LLM) with enrichment, confidence gating, and supervisor safety checks (aligned, destructive, suspicious, ambiguous). Verdicts: EXECUTE, ESCALATE, DEFER, ABSORB, BLOCK.

5. **Full audit trail** — SQLite with 7 tables (tasks, conversations, intents, decisions, sidechats, intent_traces, logs). Every conversation turn, every tool approval decision, every veracity check result is recorded and queryable. DbWorker serializes all access through a single thread with FIFO ordering.

6. **Interactive REPL with sidechats** — prompt_toolkit TUI with file attachments, slash commands, and sidechat threads. The user can chat while an agent run is in progress — the only system designed for real-time human-agent collaboration during execution.

### Longshot: Parallel Execution Infrastructure

1. **Hierarchical task decomposition** — Root planner maintains a persistent LLM conversation, decomposes into tasks. Tasks with scope ≥ 4 files are routed to a subplanner (max depth 3, max 10 subtasks per batch). Each planner has its own Pi agent session.

2. **Delta-optimized replanning** — Planner tracks file tree hash, FEATURES.json hash, DECISIONS.md hash. Only sends changed content on each iteration (~40K chars saved per replan cycle). Minimum 3 handoffs collected before replanning.

3. **Self-healing merge pipeline** — Three layers: (a) Merge queue with rebase-then-retry (max 2 conflict retries), strategy fallback (rebase → merge-commit). (b) Reconciler runs tsc + build + test sweeps with adaptive intervals (60s–5min), generates max 5 fix tasks per sweep, tracks recent fix scopes to prevent duplicates. (c) Finalization: 3 corrective sweeps post-planning (drain merges → reconcile → fix → repeat).

4. **Weighted LLM routing with health tracking** — Multi-endpoint `WeightedRoundRobinSelector`. EMA-smoothed latency (α=0.3). 3 consecutive failures marks endpoint unhealthy. Recovery probe after 30s. Faster endpoints get up to 2x weight. Readiness probe via `/v1/models`.

5. **Comprehensive dependency injection** — Every major class (Planner, Subplanner, Reconciler, MergeQueue, WorkerPool, Monitor) accepts a `*Deps` interface for testability. Injects spawn, sleep, time, filesystem. Tests are deterministic and fast with no monkeypatching.

6. **Structured handoff protocol** — Workers produce a typed `Handoff` JSON: taskId, status, summary, diff, filesChanged, concerns, suggestions, metrics (linesAdded, linesRemoved, tokensUsed, toolCallCount, durationMs), buildExitCode. This feeds back into the planner's next iteration.

7. **Scope tracking** — `ScopeTracker` maintains a `Map<taskId, Set<filePaths>>`. `getOverlaps()` detects conflicts before dispatch. `getLockedFiles()` is reported to the planner so it avoids assigning conflicting work.

### Agent Orchestrator: DevOps Lifecycle Integration

1. **7-slot plugin architecture** — Runtime (tmux/process), Agent (claude-code/codex/aider/opencode), Workspace (worktree/clone), Tracker (github/linear/gitlab), SCM (github/gitlab), Notifier (slack/desktop/composio/webhook/openclaw), Terminal (iterm2/web). Plugins are keyed as `"slot:name"`, loaded dynamically, with graceful degradation on missing packages.

2. **Lifecycle reaction engine** — Configurable reactions to state transitions: ci-failed → send error to agent (max 2 retries, escalate after), changes-requested → send review comments (escalate after 30 min), merge-conflicts → send to agent (escalate after 15 min), approved+green → notify human. Retry counts and time-based escalation thresholds are per-project configurable.

3. **SCM-native CI/review integration** — GitHub plugin queries check runs, status checks, review decisions, merge readiness (CI + reviews + conflicts + draft + branch protection), pending comments via GraphQL, bot detection (Dependabot, CodeCov, SonarCloud, etc.), webhook verification (HMAC-SHA256).

4. **Orchestrator-as-agent** — The supervisor is itself a Claude Code session with CLI access. It uses `ao spawn`, `ao send`, `ao status` to manage workers. Recursive agent-manages-agents pattern. The orchestrator prompt enforces read-only constraints (must delegate code changes to workers).

5. **Notification routing** — Priority-based routing: `urgent` → [desktop, composio], `action` → [desktop, composio], `warning` → [composio], `info` → [composio]. Slack Block Kit formatting. Desktop OS-native notifications. Webhook for generic integrations.

6. **Session recovery system** — Scanner detects corrupted/orphaned sessions (missing worktrees, dead runtimes, inconsistent metadata). Validator assesses health. Actions: restore, cleanup, escalate, skip. Supports dry-run mode.

7. **Agent activity detection** — Reads last 128KB of Claude Code JSONL session files, parses tool_use events, determines active/waiting/idle. Fallback: regex scan of tmux terminal output. Bash hooks auto-detect `gh pr create` and `git checkout -b` to update session metadata.

### pi-autoresearch: Emergent Loop & Persistence Patterns

1. **LLM-as-loop-controller** — No imperative loop code. The loop is emergent from: (a) skill rules ("LOOP FOREVER"), (b) system prompt injection on every agent turn, (c) auto-resume on context exhaustion. The extension provides measurement tools; the LLM decides what to try, when to keep/discard, and what to try next.

2. **Append-only JSONL with segment reconstruction** — State is never mutated — only appended. Config headers create logical segments. On every session start/switch/fork, `reconstructState()` replays the entire JSONL log to rebuild in-memory state. This means the system survives any crash with zero data loss.

3. **Auto-resume with cooldown** — When context limits hit, the `agent_end` event fires. If conditions are met (autoresearch mode active, at least one experiment run this session, 5-min cooldown since last resume, turn count < 20), `sendUserMessage()` starts a fresh agent that reads `autoresearch.md` and git log for context. The agent seamlessly continues the loop across context boundaries.

4. **Metric-gated quality** — `log_experiment` gates "keep" on the last `run_experiment`'s checks result. Secondary metric consistency is enforced (all previously-tracked metrics required on every log call). New metrics require `force: true`. This prevents metric drift across a long experiment session.

5. **Two-layer architecture (extension + skill)** — Complete separation between domain-agnostic infrastructure (tools, persistence, dashboard) and domain-specific knowledge (setup procedure, loop rules, file templates). The extension never changes per domain. New optimization domains are created by writing a new SKILL.md — no code changes needed.

6. **Git commit automation with structured trailers** — On "keep", the extension runs `git add -A && git commit` with a structured message containing a `Result: {JSON}` trailer. On discard/crash, the extension tells the agent to run `git checkout -- .`. The extension handles commits; the agent handles reverts. This split prevents the agent from committing bad code.

---

## The Unified Architecture

### Design Principles (Drawn from All Four)

Each principle below is attributed to the project that best demonstrates it:

1. **Plugin-first** (from Agent Orchestrator): Every external integration is a swappable slot. Agent, runtime, SCM, tracker, notifier — all are plugins with defined interfaces.
2. **Inline verification** (from tcagent): Quality is checked inline, not just eventually. Veracity + tool policy + quality gates run before code is committed.
3. **Parallel when beneficial** (from Longshot): Decompose large tasks into parallel subtasks with scope isolation. Serialize merging with conflict resolution.
4. **Emergent over imperative** (from pi-autoresearch): Let the LLM drive behavior through prompt engineering, not complex state machines. The system provides tools; the LLM provides the loop.
5. **Append-only persistence** (from pi-autoresearch + tcagent): Never mutate state. Append events, reconstruct on startup. Survive any crash.
6. **React to DevOps lifecycle** (from Agent Orchestrator): Auto-handle CI failures, review comments, merge readiness. Escalate to humans only when needed.
7. **Dependency injection everywhere** (from Longshot): Every external dependency is injectable for deterministic testing. No monkeypatching.

### Architecture Overview

The diagram below shows how components from each project layer together. Annotations in parentheses indicate which project each component is drawn from.

```
┌────────────────────────────────────────────────────────────┐
│                    CLI / Dashboard / Mobile                 │
│  Commands: start, spawn, send, status, kill, doctor        │
│  Web dashboard (Next.js) + Mobile (React Native)           │
└───────────────────────┬────────────────────────────────────┘
                        │
┌───────────────────────▼────────────────────────────────────┐
│                   Orchestrator Layer                        │
│                                                            │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐ │
│  │ Session Mgr  │  │ Lifecycle Mgr│  │ Task Decomposer   │ │
│  │ (from ao)    │  │ (from ao)    │  │ (from Longshot)   │ │
│  │ spawn/kill/  │  │ poll + react │  │ recursive LLM     │ │
│  │ send/restore │  │ CI/review/   │  │ decomposition     │ │
│  │              │  │ merge/stuck  │  │ scope tracking    │ │
│  └──────────────┘  └──────────────┘  └───────────────────┘ │
│                                                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Plugin Registry (from ao)                            │   │
│  │ 7 slots: Runtime | Agent | Workspace | Tracker |     │   │
│  │          SCM | Notifier | Terminal                   │   │
│  └─────────────────────────────────────────────────────┘   │
└───────────────────────┬────────────────────────────────────┘
                        │
┌───────────────────────▼────────────────────────────────────┐
│              Per-Session Supervisor                         │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Quality Pipeline (from tcagent)                       │  │
│  │  1. Veracity Tier 1 — regex, zero-cost               │  │
│  │  2. Veracity Tier 2 — LLM grounding check            │  │
│  │  3. Tool policy gate — auto/evaluate/human/blocked    │  │
│  │  4. Quality gates — lint/test/typecheck               │  │
│  │  5. Reviewer agent — optional 2nd AI instance         │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Prompt Builder (from ao + pi-autoresearch)            │  │
│  │  Base + Config + User Rules + Decomposition Context   │  │
│  │  + System prompt injection for mode-specific behavior │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Auto-Resume (from pi-autoresearch)                    │  │
│  │  Context exhaustion → cooldown → resume with context  │  │
│  └──────────────────────────────────────────────────────┘  │
└───────────────────────┬────────────────────────────────────┘
                        │
┌───────────────────────▼────────────────────────────────────┐
│                  Isolated Agent Sessions                    │
│                                                            │
│  Session 1              Session 2              Session N   │
│  ┌───────────────┐     ┌───────────────┐     ┌──────────┐ │
│  │ Git Worktree   │     │ Git Worktree   │     │ ...      │ │
│  │ tmux/process   │     │ tmux/process   │     │          │ │
│  │ AI Agent       │     │ AI Agent       │     │          │ │
│  │ JSONL Event Log│     │ JSONL Event Log│     │          │ │
│  └───────────────┘     └───────────────┘     └──────────┘ │
└───────────────────────┬────────────────────────────────────┘
                        │
┌───────────────────────▼────────────────────────────────────┐
│                  Merge & Reconciliation (from Longshot)     │
│                                                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐ │
│  │ Merge Queue   │  │ Reconciler   │  │ Finalization     │ │
│  │ Serial merge  │  │ Periodic     │  │ 3 corrective     │ │
│  │ rebase+retry  │  │ tsc+build+   │  │ sweeps after     │ │
│  │ conflict fix  │  │ test sweeps  │  │ planning ends    │ │
│  └──────────────┘  └──────────────┘  └──────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

### Traceability: What Comes from Where

Every component in the unified system traces back to a specific project. This table serves as a reference for implementation — when building a component, study the source project's implementation first.

| Concern | Source Project | Key Files to Study |
|---------|---------------|-------------------|
| Plugin system | [Agent Orchestrator](https://github.com/ComposioHQ/agent-orchestrator) | `packages/core/src/plugin-registry.ts`, `packages/core/src/types.ts` |
| Session management | [Agent Orchestrator](https://github.com/ComposioHQ/agent-orchestrator) | `packages/core/src/session-manager.ts` |
| Lifecycle polling | [Agent Orchestrator](https://github.com/ComposioHQ/agent-orchestrator) | `packages/core/src/lifecycle-manager.ts` |
| Reaction engine | [Agent Orchestrator](https://github.com/ComposioHQ/agent-orchestrator) | `packages/core/src/lifecycle-manager.ts` (reaction config section) |
| SCM integration | [Agent Orchestrator](https://github.com/ComposioHQ/agent-orchestrator) | `packages/plugins/scm-github/src/index.ts` |
| Notification routing | [Agent Orchestrator](https://github.com/ComposioHQ/agent-orchestrator) | `packages/plugins/notifier-slack/`, `notifier-desktop/` |
| Orchestrator agent | [Agent Orchestrator](https://github.com/ComposioHQ/agent-orchestrator) | `packages/core/src/orchestrator-prompt.ts` |
| Agent activity detection | [Agent Orchestrator](https://github.com/ComposioHQ/agent-orchestrator) | `packages/plugins/agent-claude-code/src/index.ts` |
| Task decomposition | [Longshot](https://github.com/Blastgits/longshot) | `packages/orchestrator/src/planner.ts`, `subplanner.ts` |
| Scope tracking | [Longshot](https://github.com/Blastgits/longshot) | `packages/orchestrator/src/planner.ts` (ScopeTracker usage) |
| Merge queue | [Longshot](https://github.com/Blastgits/longshot) | `packages/orchestrator/src/merge-queue.ts` |
| Reconciler | [Longshot](https://github.com/Blastgits/longshot) | `packages/orchestrator/src/reconciler.ts` |
| Finalization | [Longshot](https://github.com/Blastgits/longshot) | `packages/orchestrator/src/orchestrator.ts` (finalization section) |
| LLM health tracking | [Longshot](https://github.com/Blastgits/longshot) | `packages/orchestrator/src/llm-client.ts` |
| Dependency injection | [Longshot](https://github.com/Blastgits/longshot) | `packages/orchestrator/src/worker-pool.ts` (WorkerPoolDeps pattern) |
| Handoff protocol | [Longshot](https://github.com/Blastgits/longshot) | `packages/core/src/types.ts` (Handoff interface) |
| Veracity checking | [tcagent](https://github.com/TaisoAI/tcagent) | `src/tcagent/veracity.py` |
| Tool policy | [tcagent](https://github.com/TaisoAI/tcagent) | `src/tcagent/tool_policy.py`, `approval_gate.py` |
| Reviewer agent | [tcagent](https://github.com/TaisoAI/tcagent) | `src/tcagent/reviewer.py` |
| Quality pipeline | [tcagent](https://github.com/TaisoAI/tcagent) | `src/tcagent/coder.py` (`_run_step` method) |
| Audit trail | [tcagent](https://github.com/TaisoAI/tcagent) | `src/tcagent/db.py`, `db_worker.py` |
| Auto-resume | [pi-autoresearch](https://github.com/davebcn87/pi-autoresearch) | `extensions/pi-autoresearch/index.ts` (agent_end handler) |
| Metric-gated commits | [pi-autoresearch](https://github.com/davebcn87/pi-autoresearch) | `extensions/pi-autoresearch/index.ts` (log_experiment) |
| Append-only persistence | [pi-autoresearch](https://github.com/davebcn87/pi-autoresearch) | `extensions/pi-autoresearch/index.ts` (reconstructState) |
| System prompt injection | [pi-autoresearch](https://github.com/davebcn87/pi-autoresearch) | `extensions/pi-autoresearch/index.ts` (before_agent_start) |
| Extension + Skill separation | [pi-autoresearch](https://github.com/davebcn87/pi-autoresearch) | `skills/autoresearch-create/SKILL.md` |

---

## Actionable Implementation Plan

The plan is divided into 5 phases. Each phase is independently valuable — you can ship Phase 1 and get a useful tool, then layer on subsequent phases. This avoids the risk of a big-bang integration.

### Phase 1: Foundation (Core + Plugin System)

Build the skeleton that everything hangs on. After this phase, you have a working CLI that can spawn, message, and manage isolated agent sessions.

**1.1 Plugin registry (from [Agent Orchestrator](https://github.com/ComposioHQ/agent-orchestrator))**

Port ao's 7-slot plugin system. Each slot has a TypeScript interface. Plugins export `{ manifest, create }`. Dynamic import with graceful degradation (missing plugin packages don't crash the system). Start with 2 implementations per slot:
- Runtime: tmux, process
- Agent: claude-code, codex
- Workspace: worktree, clone
- Tracker: github (issues)
- SCM: github (PRs, CI, reviews)
- Notifier: desktop, slack
- Terminal: web

**1.2 Session manager (from [Agent Orchestrator](https://github.com/ComposioHQ/agent-orchestrator))**

Port ao's session CRUD. Flat-file metadata with atomic writes (temp file + rename, `O_EXCL` flag for ID creation). Hash-namespaced state directories (`~/.agent-orchestrator/{sha256-hash}-{project}/`). A session = worktree + runtime + agent + branch. Sessions are archived (not deleted) on kill.

**1.3 Configuration (from [Agent Orchestrator](https://github.com/ComposioHQ/agent-orchestrator) + [Longshot](https://github.com/Blastgits/longshot))**

Zod-validated YAML config with search order (env var → walk up directory tree → home directory). Per-project overrides for agent, runtime, reactions. LLM endpoint configuration with multi-endpoint weights (from Longshot's `LLM_ENDPOINTS` pattern).

**1.4 Dependency injection pattern (from [Longshot](https://github.com/Blastgits/longshot))**

Every major class accepts a `*Deps` interface. Production defaults are the real implementations. Tests inject fakes for subprocess spawning, sleep/timers, filesystem access, LLM calls. No monkeypatching — all external effects are injected.

**1.5 CLI skeleton (from [Agent Orchestrator](https://github.com/ComposioHQ/agent-orchestrator))**

Commander.js CLI with: `start`, `stop`, `spawn`, `batch-spawn`, `send`, `status`, `kill`, `cleanup`, `doctor`, `init`. Each command delegates to the core library.

**Deliverable**: Can spawn isolated agent sessions, send messages, kill sessions, view status. No lifecycle management, no quality checks, no parallelism yet.

---

### Phase 2: Quality Pipeline (Per-Session Supervision)

Add inline verification to each agent session. After this phase, hallucinations are caught, dangerous operations are gated, and code quality is checked before committing.

**2.1 Veracity checking (from [tcagent](https://github.com/TaisoAI/tcagent))**

Port tcagent's two-tier system:
- Tier 1: Regex patterns for hallucinated execution ("I've created", "successfully built", "I ran the command"). Zero-cost, always runs.
- Tier 2: LLM grounding check. Sends context + response to a verifier that identifies unsubstantiated claims. Optional, configurable per project.

**2.2 Tool policy (from [tcagent](https://github.com/TaisoAI/tcagent))**

Port tcagent's 4-tier system: `auto_approve`, `evaluate`, `require_human`, `blocked`. Glob-pattern matching against tool name + arguments. LLM evaluation for the "evaluate" tier. Thread-safe approval gate with configurable timeout. Integrated into agent output stream parsing.

**2.3 Quality gates (from [tcagent](https://github.com/TaisoAI/tcagent) + [Longshot](https://github.com/Blastgits/longshot))**

Auto-detect quality tools from project config (ruff, mypy, pytest, eslint, tsc). Run after agent completes a code change. Parallel execution (lint + test + typecheck simultaneously via `Promise.all`). Retry with failure context on gate failure.

**2.4 Reviewer agent (from [tcagent](https://github.com/TaisoAI/tcagent))**

Optional second agent instance with read-only tools. Reviews primary agent's work. Verdicts: ON_TRACK, ISSUES_FOUND, NEEDS_USER. Configurable per project (enabled by default, can disable for speed).

**2.5 Composable quality pipeline**

Wire veracity → tool policy → gates → reviewer into a single `runQualityPipeline()` function that returns pass/fail with detailed results. Each stage can be independently enabled/disabled via config:

```yaml
projects:
  my-app:
    quality:
      veracity: true          # Tier 1 always on; Tier 2 if LLM available
      toolPolicy: auto        # or: strict, permissive, custom
      qualityGates: true      # auto-detect from project
      reviewer: false         # disable for speed
```

**Deliverable**: Each agent session has inline quality verification. Hallucinations are caught, dangerous tools are gated, code quality is checked, and optionally a reviewer agent provides a second opinion.

---

### Phase 3: Lifecycle & Reactions (DevOps Integration)

Add the automated supervision layer. After this phase, CI failures auto-retry, review comments auto-forward, context exhaustion auto-resumes, and humans are notified only when escalation is needed.

**3.1 Lifecycle worker (from [Agent Orchestrator](https://github.com/ComposioHQ/agent-orchestrator))**

Port ao's detached background process. Polls every 30s. Multi-step status detection per session: runtime alive → agent activity → PR state → CI checks → review decisions → stuck detection. PID file management. Structured JSON logging.

**3.2 Session state machine (from [Agent Orchestrator](https://github.com/ComposioHQ/agent-orchestrator))**

Port ao's status flow: `spawning → working → pr_open → review_pending → approved → mergeable → merged`. Error branches: `ci_failed`, `changes_requested`, `merge_conflicts`, `stuck`, `needs_input`.

**3.3 Reaction engine (from [Agent Orchestrator](https://github.com/ComposioHQ/agent-orchestrator))**

Port ao's configurable reactions with sensible defaults:
- `ci-failed`: send failure output to agent, max 2 retries, then escalate to human
- `changes-requested`: send review comments to agent, escalate after 30 min
- `merge-conflicts`: send to agent, escalate after 15 min
- `approved+green`: notify human for merge decision
- `stuck`: notify human after 10 min of no activity

**3.4 Agent activity detection (from [Agent Orchestrator](https://github.com/ComposioHQ/agent-orchestrator) + [pi-autoresearch](https://github.com/davebcn87/pi-autoresearch))**

Combine ao's JSONL reading (last 128KB of session files) with pi-autoresearch's session-aware state reconstruction. Detect: active tool calls, waiting for input, idle, completed.

**3.5 Notification routing (from [Agent Orchestrator](https://github.com/ComposioHQ/agent-orchestrator))**

Priority-based routing to multiple channels. Desktop for urgent. Slack/webhook for everything. Composio for rich integrations.

**3.6 Auto-resume (from [pi-autoresearch](https://github.com/davebcn87/pi-autoresearch))**

Port pi-autoresearch's context-exhaustion handler: when an agent hits context limits, auto-resume with cooldown (5 min), turn cap (20), and a resume message that points to persistent context files. The fresh agent reads state files and continues where the previous one left off.

**Deliverable**: The system automatically handles CI failures, review comments, merge conflicts, and context exhaustion. Humans are notified only when escalation is needed.

---

### Phase 4: Parallel Execution (Multi-Session Coordination)

Add the ability to decompose and parallelize. After this phase, large tasks are automatically split into parallel subtasks with isolated execution and safe merging.

**4.1 Task decomposition (from [Longshot](https://github.com/Blastgits/longshot))**

Port Longshot's recursive decomposer: classify task as atomic/composite via LLM, decompose composite tasks (max depth 3, max 10 subtasks), validate scope non-overlap between subtasks, spawn parallel sessions for leaf tasks.

**4.2 Scope tracker (from [Longshot](https://github.com/Blastgits/longshot))**

Port Longshot's `ScopeTracker`: `Map<sessionId, Set<filePaths>>`. Check overlaps before spawning. Report locked files to the decomposer so it avoids assigning conflicting work. Warn on detected conflicts.

**4.3 Handoff protocol (from [Longshot](https://github.com/Blastgits/longshot))**

Define a typed handoff structure that completed sessions produce: summary of what was done, files changed, decisions made, concerns, suggestions for follow-up. Feed handoffs back into the orchestrator's context for informed coordination.

**4.4 Merge queue (from [Longshot](https://github.com/Blastgits/longshot))**

Port Longshot's serial priority merge: priority-ordered queue with deduplication, rebase-before-retry on conflicts (max 2 retries), strategy fallback (rebase → merge-commit), `ensureCleanState` cleanup in `finally` blocks.

**4.5 Reconciler (from [Longshot](https://github.com/Blastgits/longshot))**

Port Longshot's periodic health sweeper: runs tsc + build + test on main after merges. Adaptive intervals (faster sweeps on failures, slower after 3 consecutive green sweeps). Max 5 fix tasks per sweep. Deduplicates via recent fix scope tracking.

**4.6 Finalization (from [Longshot](https://github.com/Blastgits/longshot))**

Port Longshot's post-completion corrective loop: drain merge queue → run reconciler → spawn fix tasks if needed → repeat (max 3 cycles). Ensures the codebase is healthy after all parallel work is integrated.

**Deliverable**: Large tasks are automatically decomposed into parallel subtasks. Each subtask runs in an isolated session with its own quality pipeline. Results are merged with conflict resolution and build verification.

---

### Phase 5: Observability & Advanced Features

**5.1 Structured tracing (from [Longshot](https://github.com/Blastgits/longshot) + [pi-autoresearch](https://github.com/davebcn87/pi-autoresearch))**

NDJSON trace files with spans for every operation: agent invocation, quality pipeline, merge attempt, reconciler sweep. LLM call details in a separate correlated file (keeps traces lean). Spans support parent-child relationships, attributes, and duration.

**5.2 Metrics dashboard (from [Longshot](https://github.com/Blastgits/longshot) + [Agent Orchestrator](https://github.com/ComposioHQ/agent-orchestrator))**

Aggregate metrics across all sessions: total tokens consumed, total cost, sessions completed/failed, merge success rate, quality gate pass rates, mean time to merge. File-based metrics with per-process snapshots, aggregated on read.

**5.3 Experiment mode (from [pi-autoresearch](https://github.com/davebcn87/pi-autoresearch))**

Port pi-autoresearch's optimization loop as an alternative execution mode: instead of "implement feature X", run "optimize metric Y". Append-only JSONL tracking, metric-gated commits (only keep changes that improve the metric), auto-resume across context boundaries, dashboard with trend visualization.

**5.4 Cost tracking and budgets**

Per-session, per-project, and aggregate cost tracking. Budget limits with alerts. Cost-per-issue analytics. Support multiple pricing models (API-based with token counts, self-hosted with custom rates).

**5.5 Orchestrator-as-agent (from [Agent Orchestrator](https://github.com/ComposioHQ/agent-orchestrator))**

Port ao's recursive pattern: the supervisory orchestrator is a Claude Code session that uses CLI commands to manage workers. Orchestrator prompt enforces read-only constraints and documents all available commands. The orchestrator reasons about task assignment, priority, and coordination at a higher level than individual workers.

**5.6 Recovery system (from [Agent Orchestrator](https://github.com/ComposioHQ/agent-orchestrator))**

Port ao's scan → validate → act → report cycle. Detect corrupted sessions (missing worktrees, dead runtimes, inconsistent metadata). Auto-recover as part of the lifecycle loop (every 5th cycle).

---

## Key Technical Decisions

### 1. TypeScript over Python

Longshot, Agent Orchestrator, and pi-autoresearch are all TypeScript. tcagent is the only Python project. TypeScript is the better choice for this system because:
- Better async/subprocess management via Node.js event loop
- Plugin dynamic import is native ESM (`import()`)
- Shared types across CLI, web dashboard, and mobile app
- Mature monorepo tooling (pnpm workspaces, Turborepo)

tcagent's patterns (veracity checking, tool policy, quality pipeline) should be ported to TypeScript.

### 2. Flat files over databases

All four projects avoid traditional databases. The consensus pattern:
- Session metadata: key=value flat files with atomic writes (from ao)
- Event history: append-only JSONL with reconstruction on startup (from pi-autoresearch)
- Configuration: YAML with Zod schema validation (from ao, Longshot)
- Observability: JSON snapshots aggregated on read (from ao)

This is correct for a developer tool. No daemon process, no schema migrations, no connection strings.

### 3. Polling over webhooks (initially)

Start with ao's 30-second polling. It's simpler, more reliable, and works without infrastructure setup. Add webhook support later as an optimization for latency-sensitive flows (CI completion, review events). The GitHub SCM plugin already has webhook verification code — it just needs to be connected to the lifecycle manager.

### 4. Quality pipeline is optional and configurable

Not every session needs a reviewer agent and two-tier veracity checking. The quality pipeline should be composable — each stage independently enabled/disabled via project config. Default to lightweight: Tier 1 veracity (zero-cost regex) + auto-detected quality gates.

### 5. Parallelism is opt-in

Single-session sequential execution is the default. Decomposition and parallel spawning require an explicit `--decompose` flag or a config setting. This avoids the complexity of merge queues and scope tracking for simple, single-issue tasks.

---

## What NOT to Build

These are capabilities from the source projects that should be deliberately excluded:

1. **Self-hosted LLM infrastructure** (Longshot's GLM-5 on 8x B200 GPUs via Modal). Powerful but niche. Support any OpenAI-compatible endpoint instead — let users bring their own model.
2. **Custom TUI framework** (tcagent's prompt_toolkit REPL with sidechats). High implementation cost for limited benefit. Use existing terminal tools (tmux attach for direct access, web dashboard for monitoring).
3. **Agent-internal tool implementation** (Longshot's Pi agent tools: read, write, edit, bash). The orchestrator manages agents, not replaces them. Delegate tool execution to existing agent CLIs.
4. **Complex intent classification** (tcagent's 2-pass extraction pipeline). Over-engineered for a CLI tool where user commands are explicit. Simple command parsing is sufficient.
5. **Social media simulation**. Different problem domain entirely.

---

## Success Criteria

**After Phase 1**: Can spawn, message, and kill isolated agent sessions with any supported agent CLI (Claude Code, Codex, Aider, OpenCode). Clean plugin architecture with swappable implementations. Tests pass with injected dependencies.

**After Phase 2**: Hallucinations are caught before code is committed. Dangerous tool calls are gated. Quality gates (lint/test/typecheck) run automatically. Each session produces verified output.

**After Phase 3**: CI failures auto-retry (max 2 attempts). Review comments auto-forward to agents. Context exhaustion auto-resumes. Humans get Slack/desktop notifications only when genuine escalation is needed.

**After Phase 4**: A 20-file feature request decomposes into 4-5 parallel sessions. Each runs quality-verified in isolation. Results merge cleanly via the serial merge queue. Build passes after integration, verified by the reconciler.

**After Phase 5**: Full observability into token costs, session durations, and quality gate pass rates. Experiment mode for metric optimization. Orchestrator agent for autonomous fleet management. Recovery system for self-healing after crashes.

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Complexity explosion from combining 4 systems | Phase-gated delivery. Each phase is independently valuable. Ship Phase 1–2 before starting Phase 3–4. |
| Quality pipeline slows down fast iterations | Every quality stage is independently toggleable. Default to lightweight (Tier 1 veracity + auto-detect gates). |
| Parallel sessions create merge conflicts | Scope tracker prevents file overlap. Merge queue serializes integration. Reconciler catches what slips through. Start with max 3 parallel sessions. |
| Agent CLI updates break plugins | Plugin interface is stable (launch command + activity detection). Agent-specific parsing (JSONL format, output patterns) is encapsulated within the plugin. |
| File-based state corrupts under concurrency | Atomic writes (temp file + rename). `O_EXCL` for creation. JSONL is append-only. Session manager is the single writer. |
| Auto-resume creates infinite loops | Cooldown timer (5 min between resumes). Turn cap (20 max). Experiments-this-session guard (must have done work before resuming). |
| Orchestrator agent makes bad decisions | Orchestrator has read-only constraints — it cannot write code directly. All code changes go through worker agents with quality pipelines. Bad orchestrator decisions are bounded by session-level verification. |
