# Feature Gap Analysis: Source Projects vs Ultracoder

Ultracoder synthesizes patterns from four open-source projects. This document compares their features against what is implemented in ultracoder, identifying gaps and prioritizing what to build next.

Last updated: 2026-03-21

## Legend

- **Implemented** = exists in ultracoder with real logic + tests
- **Partial** = concept exists but missing key aspects from the source
- **Missing** = feature exists in source project but not in ultracoder

---

## From tcagent (Inline Verification)

Source: https://github.com/TaisoAI/tcagent

| Feature | Status | Notes |
|---------|--------|-------|
| Veracity regex (hallucination detection) | **Implemented** | 15+ patterns in `quality/veracity.ts` |
| Veracity filesystem cross-check | **Implemented** | Git diff/status verification |
| Veracity LLM grounding (Tier 2) | **Implemented** | `checkVeracityLlm()` calls agent CLI for grounding check; configurable via `quality.veracity.llm`; merges with regex in "both" mode; graceful degradation on failure |
| Tool policy (4-tier: auto/evaluate/human/blocked) | **Implemented** | Full heuristic rules engine with `requiresApproval` flag for human tier |
| Quality gates (lint/test/typecheck) | **Implemented** | Auto-detection + parallel execution |
| Reviewer agent | **Implemented** | Claude-powered diff review |
| Approval gate (human-in-the-loop for tool calls) | **Implemented** | `ApprovalGate` with file-backed persistence, CLI commands (`uc approve/deny/approvals`), timeout sweep, integrated with tool policy `human` tier |
| Question detection & auto-answer | **Implemented** | `question-detector.ts` with regex patterns (9 patterns, 0.5-0.9 confidence) + `tryAutoAnswer()` via agent CLI with ESCALATE support |
| Web UI dashboard | **Implemented** | `packages/web/` with inline HTML dashboard, SSE real-time updates, REST API, session cards with status badges |
| Checklist-driven supervision | **Missing** | tcagent's step-by-step checklist with per-step verification. Ultracoder has no checklist concept |
| Automatic retry on gate failure | **Partial** | Lifecycle reactions handle retries, but no automatic re-injection of failure context into the agent's next prompt |
| Sidechats / named conversation threads | **Missing** | tcagent stores persistent side conversations. No equivalent in ultracoder |
| Intent capture & audit trail | **Partial** | Ultracoder has intent classification (8 types from tool patterns) but no intent extraction from user messages, no structured audit trail in DB |
| Decisions & rules persistence | **Missing** | tcagent stores project decisions/rules that persist across sessions and are injected into agent context. No equivalent |
| Agent streaming with real-time tool interception | **Partial** | Claude Code stream parser exists, but no real-time tool approval/interception (SIGSTOP/SIGCONT pattern) |
| Multi-provider LLM for supervisor reasoning | **Partial** | LLM router exists with weighted endpoints and latency-adaptive routing, but only used for reviewer/synthesizer, not for a separate supervisor agent |
| Project auto-detection (language, test framework, CI) | **Missing** | tcagent auto-detects from manifest files. Ultracoder's `doctor` checks deps but doesn't auto-configure |
| Context enrichment (layered system prompt) | **Implemented** | 4-layer prompt builder in `core/prompt-builder.ts`: base instructions, project context, user rules (`agentRules`/`agentRulesFile`), task. Integrated into spawn pipeline. tcagent has 6 layers (adds checklist state, decisions, file attachments) |
| Conversation history with pruning | **Missing** | tcagent stores full conversation history with context window management. Ultracoder delegates this to the agent |
| File attachment system | **Missing** | tcagent's `/file` command with proportional truncation. No equivalent |

---

## From Longshot (Parallel Execution)

Source: https://github.com/Blastgits/longshot

| Feature | Status | Notes |
|---------|--------|-------|
| LLM-driven task decomposition | **Implemented** | `parallel/decomposer.ts` with agent CLI calls |
| Scope tracker (file-level concurrency) | **Implemented** | `parallel/scope-tracker.ts` |
| Merge queue with priority ordering | **Implemented** | `parallel/merge-queue.ts` |
| Reconciler (build/test sweeps) | **Implemented** | `parallel/reconciler.ts` |
| Finalization phase | **Implemented** | `parallel/finalization.ts` |
| Dependency injection everywhere | **Implemented** | Consistent `Deps` pattern across all packages |
| Recursive subplanner (3 levels deep) | **Implemented** | `decomposeRecursive()` with `shouldDecompose()` heuristic (>4 files or >500 char description), configurable `maxDepth` (default 3), dependency remapping when parent subtasks are decomposed |
| Iterative re-planning | **Implemented** | `replanner.ts` with `shouldReplan()` (triggers on failed/partial/concerns) + `replan()` that builds enriched prompt from handoff reports and calls decomposer |
| Conflict resolution tasks | **Implemented** | `conflict-resolver.ts` with `identifyConflictFiles()` via `git merge-tree` (read-only) and `generateConflictTask()` with file list + original context |
| Latency-adaptive LLM routing | **Implemented** | EMA tracking (alpha=0.3), health monitoring (unhealthy after 3 failures), probe recovery (30s interval), adjusted weights (0.5x-2.0x) in `llm-router.ts` |
| Ephemeral cloud sandboxes (Modal) | **Partial** | Docker runtime plugin (`plugin-runtime-docker`) provides local container isolation with filesystem/network/resource limits. Not cloud-hosted like Modal |
| Structured handoff protocol | **Partial** | Ultracoder has `parallel/handoff.ts` but lacks Longshot's rich handoff metrics (tokens used, tool calls, lines added/removed) |
| Worker pool with concurrency semaphore | **Partial** | `maxConcurrentSessions` exists but no semaphore-based pool pattern -- it's a check-and-reject model |
| Build verification in workers | **Missing** | Longshot workers run `tsc --noEmit` post-execution and include build status in handoff. No equivalent |
| Anomaly detection (>100 files, >50K lines) | **Missing** | Longshot warns about abnormally large changes. No equivalent |
| NDJSON streaming protocol to dashboard | **Implemented** | SSE in `packages/web/src/sse.ts` subscribes to EventBus and broadcasts to connected clients. Web dashboard consumes via `EventSource` |
| Rich TUI dashboard (4Hz, multi-panel) | **Missing** | Longshot has a full-screen Rich dashboard with agent grid, planner tree, merge queue. Ultracoder's terminal dashboard is a simpler table (web dashboard provides richer view) |
| Delta optimization for planning prompts | **Missing** | Longshot tracks file tree/feature hashes to avoid re-sending unchanged context. No equivalent |

---

## From Agent Orchestrator (Plugin-first, DevOps Lifecycle)

Source: https://github.com/ComposioHQ/agent-orchestrator

| Feature | Status | Notes |
|---------|--------|-------|
| 7-slot plugin architecture | **Implemented** | runtime, agent, workspace, tracker, scm, notifier, reviewer |
| Dynamic plugin loading | **Implemented** | By npm package name |
| 13-state session lifecycle | **Implemented** | (Agent Orchestrator has 16 states; ultracoder has 13 -- missing `stuck`, `errored`, `needs_input`, `idle`, `done`, `terminated`) |
| Lifecycle worker with reactions | **Implemented** | Polls active sessions, triggers configurable reactions |
| PR management (create, status, merge) | **Implemented** | Via scm-github plugin |
| CI tracking | **Implemented** | Via scm-github `getCIStatus()` |
| Review handling | **Implemented** | Tracks approved/changes_requested |
| Recovery system | **Implemented** | In `observability/recovery.ts` |
| Notification priority routing | **Implemented** | `NotificationRouter` with configurable priority->channel mapping. Defaults: urgent->["slack","desktop"], action->["desktop"], warning->["desktop"], info->[] |
| Structured event types | **Implemented** | 21-type `EventBus` with pub/sub in `core/events.ts`. Covers session, PR, CI, reaction, issue, experiment, approval, and merge events |
| Web dashboard | **Implemented** | `packages/web/` with HTTP server, session cards, SSE real-time updates, REST API. Simpler than Agent Orchestrator's Next.js app but functional |
| SCM webhooks | **Implemented** | GitHub webhook ingestion with HMAC-SHA256 verification in `packages/web/src/webhooks.ts`. Maps pull_request, check_suite, pull_request_review to UltracoderEvent |
| Decomposer with recursive depth | **Implemented** | `decomposeRecursive()` supports configurable `maxDepth` (default 3) with `shouldDecompose()` heuristic |
| Layered prompt builder | **Implemented** | 4-layer prompt builder in `core/prompt-builder.ts` integrated into spawn pipeline. Supports inline `agentRules` and file-based `agentRulesFile` (resolved relative to rootPath) |
| Orchestrator/worker role architecture | **Missing** | Agent Orchestrator distinguishes coordinator (read-only) from worker (implements). Ultracoder has flat sessions |
| Auto-config generation from repo URL | **Missing** | Agent Orchestrator parses GitHub/GitLab URLs, detects language/package manager, generates config. `uc init` is manual |
| Agent permission modes | **Missing** | Agent Orchestrator supports permissionless/default/auto-edit/suggest. Ultracoder delegates to agent's own permission model |
| Global pause | **Missing** | System-wide pause with reason attribution. No equivalent |
| Feedback tools (bug_report, improvement_suggestion) | **Missing** | Agents can submit structured feedback during sessions. No equivalent |
| Agent rules templates per language | **Missing** | Pre-built rule files for Go, TypeScript, Python, React, etc. No equivalent |
| Multi-project support | **Missing** | Single orchestrator managing multiple projects. Ultracoder is per-project |
| Additional tracker/SCM plugins | **Missing** | Agent Orchestrator has Linear + GitLab tracker plugins and GitLab SCM. Ultracoder has GitHub only |
| Terminal plugins (iTerm2, web) | **Partial** | Ultracoder has `terminal-web` but no iTerm2 integration |

---

## From pi-autoresearch (Append-only Persistence, Experiments)

Source: https://github.com/davebcn87/pi-autoresearch

| Feature | Status | Notes |
|---------|--------|-------|
| JSONL append-only event logs | **Implemented** | `core/util/jsonl.ts` |
| State reconstruction from logs | **Partial** | JSONL read/tail exists but no full state replay on startup -- sessions use JSON files, not log replay |
| NDJSON tracing with spans | **Implemented** | `observability/tracing.ts` |
| Cost tracking with pricing | **Implemented** | `observability/cost-tracker.ts` |
| Recovery system | **Implemented** | `observability/recovery.ts` |
| Experiment loop (measure -> evaluate -> keep/discard) | **Implemented** | Full `experiment/` package |
| Metric extraction (JSONPath, regex) | **Implemented** | `experiment/metric-runner.ts` |
| Termination checks (max iters, no-improvement, budget, target) | **Implemented** | `experiment/termination.ts` |
| Git commit on keep / revert on discard | **Implemented** | `experiment/git-ops.ts` (includes `git reset HEAD` before checkout to handle staged changes) |
| Parallel experiment variations | **Partial** | `experiment/parallel-runner.ts` exists but lifecycle worker always uses sequential `ExperimentRunner`. Parallel/hybrid modes exposed in CLI but not wired through worker. Winning variation not merged back to parent branch |
| Context writer (experiment progress file) | **Implemented** | `experiment/context-writer.ts` |
| Confidence scoring (MAD-based noise estimation) | **Implemented** | `experiment/confidence.ts` with `computeMAD()` and `computeConfidence()`. Returns score, level (high/medium/low), MAD value. Advisory only -- never blocks. Integrated into evaluator and context writer |
| Secondary metric tracking | **Implemented** | `experiment/metric-runner.ts` `runSecondaryMetrics()` with per-metric graceful degradation. Baselines tracked in `ExperimentState`. Deltas shown in progress markdown and PR body |
| Auto-resume on context limit with rate limiting | **Implemented** | `lifecycle/auto-resume.ts` with `maxResumes` (default 20), `resumeCooldownMs` (default 5 min), metadata tracking of `resumeCount` and `lastResumeAt`. Config wired from YAML into worker |
| Segmented history (re-init without losing data) | **Missing** | pi-autoresearch segments experiments with config headers in JSONL. No equivalent |
| Ideas backlog (deferred optimization ideas) | **Missing** | pi-autoresearch persists ideas across context resets. No equivalent |
| Real-time status widget / fullscreen dashboard | **Missing** | pi-autoresearch has TUI widgets for experiment progress. Ultracoder's dashboard shows sessions, not experiment metrics |
| Benchmark script guardrail | **Missing** | pi-autoresearch blocks agents from running arbitrary commands when a benchmark script exists. No equivalent |
| Backpressure/correctness checks | **Missing** | pi-autoresearch runs `checks.sh` after every benchmark to catch regressions. No equivalent |
| Anti-cheating guardrail | **Missing** | pi-autoresearch injects "don't overfit to benchmarks" into prompts. No equivalent |
| Session file as living documentation | **Missing** | pi-autoresearch writes `autoresearch.md` so a fresh agent can resume. No equivalent context file |

---

## Remaining Gaps (Lower Impact)

### Infrastructure & Config

1. **Project auto-detection and auto-config generation** — detect language, test framework, CI from manifest files; generate `ultracoder.yaml` automatically
2. **Multi-project support** — single orchestrator managing multiple projects with independent configs
3. **Global pause** — system-wide pause with reason attribution

### Plugins & Integrations

4. **Linear/GitLab tracker plugins** — extend beyond GitHub-only
5. **Agent rules templates per language** — pre-built rule files for Go, TypeScript, Python, React, etc.
6. **Agent permission modes** — permissionless/default/auto-edit/suggest (currently delegates to agent)

### Parallel Execution

7. **Anomaly detection for large changes** — warn when a task changes >100 files or adds >50K lines
8. **Build verification in workers** — run `tsc --noEmit` post-execution and include build status in handoff
9. **Rich TUI dashboard with multi-panel layout** — full-screen terminal dashboard with agent grid, planner tree, merge queue
10. **Delta optimization for planning prompts** — track file tree/feature hashes to avoid re-sending unchanged context

### Experiments

11. **Wire parallel/hybrid experiment modes** — CLI exposes modes but lifecycle worker always uses sequential runner. Winning variation not merged back to parent branch
12. **Ideas backlog for experiments** — persist deferred optimization ideas across context resets
13. **Benchmark script guardrail** — block agents from running arbitrary commands when a benchmark script exists
14. **Backpressure/correctness checks** — run `checks.sh` after every benchmark to catch regressions

### Agent Interaction

15. **Decisions/rules persistence across sessions** — store project decisions that persist and are injected into agent context
16. **Orchestrator/worker role separation** — coordinator (read-only) vs worker (implements)
17. **Checklist-driven supervision** — step-by-step checklist with per-step verification

---

## Completed Features (All Sessions)

| Feature | Commit | Details |
|---------|--------|---------|
| State machine in core | `72e3da0` | Canonical 13-state machine with `SessionManager.transition()` |
| Spawn pipeline in core | `72e3da0` | Shared `runSpawnPipeline()` with concurrency guard |
| Input validation | `72e3da0` | `validateId()` on all GitHub issue/PR ID methods |
| Veracity LLM tier | `67e18a5` | `checkVeracityLlm()` with agent CLI, schema wired, context passed in pipeline |
| Layered prompt builder | `67e18a5` | 4-layer `buildPrompt()` in core, integrated into spawn pipeline |
| Recursive decomposition | `67e18a5` | `decomposeRecursive()` with dependency remapping |
| Confidence scoring | `67e18a5` | MAD-based `computeConfidence()`, advisory levels, 15 tests |
| Secondary metrics | `67e18a5` | `runSecondaryMetrics()`, baselines, progress/PR body display |
| Auto-resume rate limiting | `67e18a5` | `maxResumes`, `resumeCooldownMs`, config wired into worker |
| Structured event bus | `e707cdd` | 21-type `EventBus` with pub/sub via Node EventEmitter |
| Notification priority routing | `e707cdd` | `NotificationRouter` with configurable priority->channel mapping |
| Latency-adaptive LLM routing | `e707cdd` | EMA tracking, health monitoring, probe recovery |
| Human approval gate | `e707cdd` | `ApprovalGate` with file persistence, CLI commands, timeout sweep |
| Question detection & auto-answer | `e707cdd` | Regex patterns + LLM auto-answer with ESCALATE support |
| Iterative re-planning | `e707cdd` | `shouldReplan()` + `replan()` from handoff reports |
| Conflict resolution tasks | `e707cdd` | `generateConflictTask()` with `git merge-tree` analysis |
| Web dashboard + webhooks | `e707cdd` | HTTP server, GitHub webhooks (HMAC), REST API, SSE, inline dashboard |
| Docker runtime plugin | `39c6ff4` | Container isolation: filesystem, network, resources, credentials |
| Codex review fixes | `448f5d5` | Approval persistence, pipeline distinction, webhook mapping, server port |
| Codex review fixes | `2e27ef7` | sendInput via attach, isAlive error handling, container cleanup, user isolation |

### Current Stats

- **21 packages**, **860+ tests**, **42 test suites**, **21/21 builds clean**
- 11 plugins across 7 slots (runtime: tmux, process, docker; agent: claude-code, codex; workspace: worktree, clone; tracker: github; scm: github; notifier: desktop, slack)
