# Feature Gap Analysis: Source Projects vs Ultracoder

Ultracoder synthesizes patterns from four open-source projects. This document compares their features against what is implemented in ultracoder, identifying gaps and prioritizing what to build next.

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
| Veracity LLM grounding (Tier 2) | **Partial** | Schema exists (`tier: "llm"`) but LLM call is a stub -- no actual second-agent verification |
| Tool policy (4-tier: auto/evaluate/human/blocked) | **Implemented** | Full heuristic rules engine |
| Quality gates (lint/test/typecheck) | **Implemented** | Auto-detection + parallel execution |
| Reviewer agent | **Implemented** | Claude-powered diff review |
| Checklist-driven supervision | **Missing** | tcagent's step-by-step checklist with per-step verification. Ultracoder has no checklist concept |
| Approval gate (human-in-the-loop for tool calls) | **Missing** | tcagent has thread-safe approval gate with `/approve` `/deny` and timeout. Ultracoder's `human` tier exists in schema but has no interactive approval mechanism |
| Question detection & auto-answer | **Missing** | tcagent detects agent questions and auto-answers from context or escalates. Ultracoder has no equivalent |
| Automatic retry on gate failure | **Partial** | Lifecycle reactions handle retries, but no automatic re-injection of failure context into the agent's next prompt |
| Web UI dashboard | **Missing** | tcagent has a FastAPI WebSocket dashboard. Ultracoder has a terminal dashboard only |
| Sidechats / named conversation threads | **Missing** | tcagent stores persistent side conversations. No equivalent in ultracoder |
| Intent capture & audit trail | **Partial** | Ultracoder has intent classification (8 types from tool patterns) but no intent extraction from user messages, no structured audit trail in DB |
| Decisions & rules persistence | **Missing** | tcagent stores project decisions/rules that persist across sessions and are injected into agent context. No equivalent |
| Agent streaming with real-time tool interception | **Partial** | Claude Code stream parser exists, but no real-time tool approval/interception (SIGSTOP/SIGCONT pattern) |
| Multi-provider LLM for supervisor reasoning | **Partial** | LLM router exists with weighted endpoints, but only used for reviewer/synthesizer, not for a separate supervisor agent |
| Project auto-detection (language, test framework, CI) | **Missing** | tcagent auto-detects from manifest files. Ultracoder's `doctor` checks deps but doesn't auto-configure |
| Context enrichment (6-layer system prompt) | **Missing** | tcagent builds rich agent prompts from project metadata, checklist state, decisions, file attachments. Ultracoder passes task string only |
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
| Recursive subplanner (3 levels deep) | **Missing** | Longshot decomposes recursively with `shouldDecompose()` heuristic. Ultracoder's decomposer is single-level |
| Ephemeral cloud sandboxes (Modal) | **Missing** | Longshot spawns per-task cloud sandboxes. Ultracoder uses local tmux/process only |
| Iterative re-planning | **Missing** | Longshot's planner re-plans after worker handoffs, incorporating results. Ultracoder decomposes once |
| Structured handoff protocol | **Partial** | Ultracoder has `parallel/handoff.ts` but lacks Longshot's rich handoff metrics (tokens used, tool calls, lines added/removed) |
| Conflict resolution tasks | **Missing** | Longshot auto-generates conflict-resolution fix tasks when merge retries are exhausted. Ultracoder detects conflicts but relies on lifecycle reactions (retry/escalate) |
| Worker pool with concurrency semaphore | **Partial** | `maxConcurrentSessions` exists but no semaphore-based pool pattern -- it's a check-and-reject model |
| Latency-adaptive LLM routing | **Missing** | Longshot's LLM client uses EMA latency tracking to adjust endpoint weights. Ultracoder's router does static weighted selection |
| Build verification in workers | **Missing** | Longshot workers run `tsc --noEmit` post-execution and include build status in handoff. No equivalent |
| Anomaly detection (>100 files, >50K lines) | **Missing** | Longshot warns about abnormally large changes. No equivalent |
| NDJSON streaming protocol to dashboard | **Partial** | Ultracoder has NDJSON tracing but the dashboard polls session state rather than consuming a live event stream |
| Rich TUI dashboard (4Hz, multi-panel) | **Missing** | Longshot has a full-screen Rich dashboard with agent grid, planner tree, merge queue. Ultracoder's dashboard is a simpler table |
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
| Notification priority routing | **Missing** | Agent Orchestrator routes notifications by priority level (urgent->slack, info->desktop). Ultracoder sends all notifications equally |
| 28 structured event types | **Missing** | Agent Orchestrator has typed events for session/PR/CI/review/merge lifecycle. Ultracoder has unstructured log messages |
| Web dashboard (Next.js) | **Missing** | Agent Orchestrator has a full web app with session cards, embedded terminals, SSE. Ultracoder has terminal dashboard only |
| SCM webhooks | **Missing** | Agent Orchestrator receives GitHub/GitLab webhooks for real-time event processing. Ultracoder polls |
| Decomposer with recursive depth | **Missing** | Agent Orchestrator's decomposer classifies atomic vs composite and recurses to `maxDepth: 3`. Ultracoder's is single-level |
| Orchestrator/worker role architecture | **Missing** | Agent Orchestrator distinguishes coordinator (read-only) from worker (implements). Ultracoder has flat sessions |
| Layered prompt builder | **Missing** | Agent Orchestrator has 3-layer prompt: base AO instructions -> project config -> user rules. Ultracoder passes raw task |
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
| Git commit on keep / revert on discard | **Implemented** | `experiment/git-ops.ts` |
| Parallel experiment variations | **Implemented** | `experiment/parallel-runner.ts` |
| Context writer (experiment progress file) | **Implemented** | `experiment/context-writer.ts` |
| Segmented history (re-init without losing data) | **Missing** | pi-autoresearch segments experiments with config headers in JSONL. No equivalent |
| Ideas backlog (deferred optimization ideas) | **Missing** | pi-autoresearch persists ideas across context resets. No equivalent |
| Confidence scoring (MAD-based noise estimation) | **Missing** | pi-autoresearch computes statistical confidence. Ultracoder's evaluator does simple delta comparison |
| Secondary metric tracking | **Missing** | pi-autoresearch tracks arbitrary secondary metrics with consistency enforcement. Ultracoder tracks one metric |
| Real-time status widget / fullscreen dashboard | **Missing** | pi-autoresearch has TUI widgets for experiment progress. Ultracoder's dashboard shows sessions, not experiment metrics |
| Auto-resume on context limit with rate limiting | **Partial** | `lifecycle/auto-resume.ts` exists but no rate limiting (max 20 turns / 5-min cooldown per pi-autoresearch) |
| Benchmark script guardrail | **Missing** | pi-autoresearch blocks agents from running arbitrary commands when a benchmark script exists. No equivalent |
| Backpressure/correctness checks | **Missing** | pi-autoresearch runs `checks.sh` after every benchmark to catch regressions. No equivalent |
| Anti-cheating guardrail | **Missing** | pi-autoresearch injects "don't overfit to benchmarks" into prompts. No equivalent |
| Session file as living documentation | **Missing** | pi-autoresearch writes `autoresearch.md` so a fresh agent can resume. No equivalent context file |

---

## Prioritized Gaps

### High Impact (would unlock new capabilities)

1. **Veracity LLM tier** -- Schema exists, just needs the actual LLM call implementation
2. **Recursive decomposition** (from Longshot + Agent Orchestrator) -- single-level decomposition limits parallel effectiveness
3. **Layered prompt builder** (from Agent Orchestrator) -- current raw task passing misses project context, rules, and constraints
4. **Webhook-driven events** (from Agent Orchestrator) -- polling is slower and more resource-intensive than push
5. **Confidence scoring for experiments** (from pi-autoresearch) -- distinguish real improvements from noise
6. **Web dashboard** (from tcagent + Agent Orchestrator) -- terminal dashboard limits visibility

### Medium Impact (polish and robustness)

7. **Human approval gate for tool calls** -- the `human` tier exists but has no interactive mechanism
8. **Question detection & auto-answer** (from tcagent) -- agents get stuck asking questions that could be auto-answered
9. **Iterative re-planning** (from Longshot) -- incorporate worker results into subsequent planning
10. **Notification priority routing** (from Agent Orchestrator) -- route urgent vs info to different channels
11. **Auto-resume rate limiting** (from pi-autoresearch) -- prevent infinite restart loops
12. **Secondary metric tracking** (from pi-autoresearch) -- track multiple metrics per experiment
13. **Structured event types** (from Agent Orchestrator) -- typed events instead of log strings
14. **Latency-adaptive LLM routing** (from Longshot) -- dynamic weight adjustment based on endpoint performance

### Lower Impact (nice-to-have)

15. Project auto-detection and auto-config generation
16. Agent rules templates per language
17. Multi-project support
18. Linear/GitLab tracker plugins
19. Ideas backlog for experiments
20. Anomaly detection for large changes
21. Decisions/rules persistence across sessions
