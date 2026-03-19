# Code Review: Implementation vs Plan — Gap Analysis

## Overall Assessment

The monorepo structure, build tooling, and package boundaries closely follow the plan. Phase 1 is solidly implemented. Phases 2-5 have correct scaffolding and interfaces but several components are **placeholders or simplified** compared to the plan's specifications. This is expected for a first pass — the architecture is right, but the "muscle" behind several subsystems is missing.

---

## Product & Architecture Decisions (from stakeholder interview)

The following decisions were captured through a detailed interview and should guide all gap remediation.

### Core Philosophy
- **Primary bet: Correctness** (tcagent) — inline verification, veracity checking, tool gating. Users want confidence that agent output is trustworthy before it lands.
- **Deployment model: CI/CD pipeline** — Ultracoder runs as a GitHub Action or CI step. Triggered by issue labels or PR comments. Agents run in CI containers.
- **Product positioning: Standalone open-source** — Independent project, community-driven. Works without any Taiso services.
- **Ship target: Full plan, all phases** — Don't ship until all 5 phases are implemented. Early adopters expect a complete product.

### State & Lifecycle
- **State machine: Full 12-state model** — Encode PR lifecycle directly in session state (spawning, working, pr_open, review_pending, approved, mergeable, merged + error branches). Enables state-driven reactions.
- **Escalation: Timestamps + scheduled timers + persistence** — Store `firstDetectedAt` in session metadata for resilience across restarts. Set timers for responsiveness. Timer fires first; timestamp is the fallback. Thresholds configurable per-project in ultracoder.yaml.
- **Auto-resume strategy: Hybrid (context + diff + task)** — New session gets: (1) original task, (2) git diff of work done, (3) structured progress summary. Most context for the least hallucination risk.

### Quality & Verification
- **Veracity: Both layers** — Language claim detection (regex) as fast first pass, then filesystem cross-check (git diff based) as authoritative verification. After agent claims completion, use `git diff` and `git status` to verify claimed files actually changed.
- **Tool policy "evaluate" tier: Heuristic rules engine** — No LLM needed. Check argument patterns, file paths, network targets against known-safe/dangerous lists. Three rule categories: network boundary rules, scope containment rules, resource limit rules.
- **Agent integration: Deep** — Parse Claude Code's stream-json output in detail: extract tool_use events, file edits, bash commands, conversation turns. Build the veracity/policy system around these structured events. Use version-pinned parsers to handle format changes.
- **Intent classification: Lightweight heuristic** — Classify based on tool patterns (many Read+Grep = exploring, Write+Edit = implementing, Bash(test) = testing). No LLM needed. Useful for dashboard and reactions.

### LLM Integration
- **LLM calls: Delegate to agent CLI** — Don't build a separate LLM client. For features needing LLM reasoning (task decomposer, reviewer), spawn a lightweight agent session (claude/codex) and reuse existing agent plugin infrastructure.

### Parallel Execution
- **Merge conflicts: Kill agent, rebase, respawn** — Stop the agent session, rebase the branch, then spawn a fresh agent to continue from the rebased state.
- **Reconciler value: Cross-session integration + main branch drift + type-level breakage** — Session A + B pass alone but break together. Reconciler validates merged result.
- **Finalization: Yes, separate phase** — After all agents complete, run 3 explicit corrective cycles: drain merge queue → reconcile → spawn fix agents → repeat. Guarantees clean state.
- **Scope persistence: Persist to disk** — Write scope assignments to JSONL. On restart, reconstruct from log. Follows append-only persistence principle.

### Infrastructure
- **Cost tracking pricing: Config-driven** — Users define pricing per model in ultracoder.yaml. Ship sensible defaults but allow overrides.
- **State storage: JSONL now, SQLite later** — Keep JSONL for v1. Design SessionManager interface to be storage-agnostic. Add SQLite migration path as future optimization.
- **GitHub polling: Batch + rate limit** — Worker batches all GitHub queries into a single GraphQL call per cycle. Add rate-limit awareness. Stay polling-only for v1.
- **Plugin security: Allowlist + escape hatch** — @ultracoder/* packages trusted by default. Custom plugins require explicit `--allow-custom-plugins` flag or `trustedPlugins` config array.

### UX & Monitoring
- **Desktop notifier: Redesign with safe APIs** — macOS: use terminal-notifier binary. Linux: notify-send (already safe). Windows: proper argument escaping. Keep desktop as default notification channel.
- **Monitoring: TUI dashboard** — Build a terminal dashboard (blessed/ink) showing all sessions, live activity, cost accumulation, quality gate results.
- **TUI data flow: File polling + inotify** — Watch JSONL files using fs.watch. New lines trigger UI updates. Simple, uses existing infrastructure.

---

## Phase 1: Foundation — Mostly Complete

| Requirement | Status | Detail |
|-------------|--------|--------|
| 7-slot plugin registry | MATCH | All 7 slots defined, dynamic import + graceful degradation working |
| Session manager with atomic writes | MATCH | Uses temp-file + rename pattern correctly |
| Session archive (not delete) | MATCH | `archive()` moves files via `fs.rename` |
| `O_EXCL` for session ID creation | DEVIATION | Uses `randomUUID().slice(0, 8)` — no exclusive-create guard. UUID collision unlikely but not prevented |
| Zod-validated YAML config | MATCH | Full schema validation with search order |
| Config: walk up directory tree | GAP | Only checks project dir + home dir. No parent directory traversal |
| Config: LLM endpoint weights | GAP | Multi-endpoint weighted routing from Longshot not implemented |
| Deps injection pattern | MATCH | All major classes accept Deps; tests use injected fakes |
| CLI: init/spawn/send/status/kill/cleanup/doctor | MATCH | All 7 commands implemented |
| CLI: start, stop, batch-spawn | GAP | 3 commands from the plan not implemented |
| 10 plugins (2 per slot) | MATCH | All 10 plugins build and have tests |
| Terminal: web plugin | GAP | Plan mentions "Terminal" as 7th slot with web implementation — not built. Slot repurposed as "reviewer" |
| Plugin export format | MATCH | All plugins export `{ create, default }` correctly |

---

## Phase 2: Quality Pipeline — Structurally Complete, Content Gaps

| Requirement | Status | Detail |
|-------------|--------|--------|
| Tier 1 veracity: hallucination regex | DEVIATION | Checks imports/URLs/versions but **does NOT catch execution claims** ("I've created", "successfully built", "I ran the command") — the primary use case from tcagent |
| Tier 1 veracity: filesystem cross-check | GAP | **Decision: Add git-diff-based verification.** After agent claims completion, verify claimed files appear in `git diff`. Not yet implemented. |
| Tier 2 veracity: LLM grounding | PLACEHOLDER | Returns "not yet implemented". **Decision: Delegate to agent CLI** — spawn lightweight agent session for verification. |
| Tool policy: 4-tier approval | MATCH | auto/evaluate/human/blocked with glob matching |
| Tool policy: evaluate tier logic | GAP | **Decision: Heuristic rules engine** with 3 categories: network boundary, scope containment, resource limits. Not yet implemented. |
| Tool policy: thread-safe timeout | GAP | No approval gate timeout mechanism |
| Quality gates: auto-detect + parallel run | MATCH | Detects pnpm/npm commands, runs via `Promise.all` |
| Quality gates: retry with failure context | GAP | Gates run once; no retry-with-context on failure |
| Reviewer: structured verdicts | DEVIATION | Plan says ON_TRACK/ISSUES_FOUND/NEEDS_USER; code uses approve/request_changes/comment |
| Reviewer: actual LLM review | PLACEHOLDER | **Decision: Delegate to agent CLI** — spawn read-only agent session for review. |
| Composable pipeline | MATCH | All 4 stages wired, independently configurable |

---

## Phase 3: Lifecycle & Reactions — Simplified

| Requirement | Status | Detail |
|-------------|--------|--------|
| State machine states | DEVIATION | **Decision: Expand to full 12-state model.** Add spawning, working, pr_open, review_pending, approved, mergeable, merged + error branches (ci_failed, changes_requested, merge_conflicts, needs_input). |
| Reaction engine triggers | MATCH | 5 triggers: ci_fail, review_requested, conflict, stuck, completed |
| Reactions: time-based escalation | GAP | **Decision: Timestamps + scheduled timers + persistence.** Store `firstDetectedAt` in session metadata. Set timer. Configurable thresholds per-project. |
| Reactions: retry counts | GAP | Plan says "max 2 retries" for ci_fail. No retry tracking in reactions |
| Reactions: execute actions | MATCH | Worker executes notify/pause/retry/kill actions |
| Lifecycle worker: 30s polling | MATCH | Configurable poll interval, defaults to 30s |
| Worker: multi-step detection | PARTIAL | Only 2 of 6 steps. **Decision: Add batched GraphQL calls** for PR state, CI checks, review decisions via SCM plugin. |
| Worker: GitHub API load | N/A | **Decision: Batch all queries into single GraphQL call per cycle.** Rate-limit aware. |
| Activity detection: 128KB tail | DEVIATION | Reads entire JSONL file. No 128KB truncation. Will cause memory issues on long sessions |
| Activity detection: intent classification | GAP | **Decision: Add lightweight heuristic classification** based on tool patterns (Read+Grep=exploring, Write+Edit=implementing, Bash(test)=testing). |
| Auto-resume: cooldown | DEVIATION | Default 30s, plan says 5 minutes (300s) |
| Auto-resume: turn cap | DEVIATION | 3 max retries, plan says 20 turn cap. Different semantics (retries vs turns) |
| Auto-resume: context strategy | GAP | **Decision: Hybrid resume.** New session gets (1) original task, (2) git diff, (3) structured progress summary. |
| Auto-resume: re-read after cooldown | MATCH | Re-reads session state after cooldown |

---

## Phase 4: Parallel Execution — Mostly Placeholders

| Requirement | Status | Detail |
|-------------|--------|--------|
| Task decomposition via LLM | PLACEHOLDER | **Decision: Delegate to agent CLI.** Spawn an agent session with a decomposition prompt. Parse structured output. |
| Scope tracker | MATCH | Overlap detection, ownership, handoff all working with tests |
| Scope tracker: persistence | GAP | **Decision: Persist to disk** via JSONL. Reconstruct on restart. |
| Handoff protocol with metrics | PARTIAL | File ownership transfer works. Missing structured handoff response (summary, diff, filesChanged, concerns, suggestions, tokens, linesAdded, duration) |
| Merge queue: priority ordering | MATCH | Priority-sorted queue with enqueue/dequeue/peek |
| Merge queue: actual merge execution | GAP | **Decision: Kill agent, rebase, respawn** on conflicts. Implement git operations with strategy fallback. |
| Reconciler: build/test sweeps | PLACEHOLDER | **Decision: Implement real tsc+build+test execution.** Catches cross-session integration failures, main branch drift, and cross-package type errors. |
| Reconciler: adaptive intervals | GAP | No interval adaptation logic |
| Finalization: 3 corrective sweeps | GAP | **Decision: Yes, separate phase.** Drain merge queue → reconcile → spawn fix agents → repeat (max 3 cycles). |

---

## Phase 5: Observability — Mostly Implemented

| Requirement | Status | Detail |
|-------------|--------|--------|
| Structured tracing with spans | MATCH | Create/end/write spans, parent-child, NDJSON output |
| Span metrics aggregation | MATCH | Total, error count, avg/max duration, by-name counts |
| Cost tracking per session | MATCH | Token counts, cost calculation, 4 pricing models |
| Cost tracking: pricing model | DEVIATION | **Decision: Config-driven pricing.** Move hardcoded prices to ultracoder.yaml with user-overridable defaults. |
| Budget enforcement | PARTIAL | Per-session budget check works. Per-day budget defined in interface but not enforced |
| Recovery: scan/validate/act/report | MATCH | All 4 phases with dry-run support |
| Recovery: check worktrees/runtimes | PARTIAL | Checks for orphaned sessions (no PID/runtime). Doesn't verify actual worktree existence or runtime process liveness |
| Orchestrator-as-agent | GAP | **Decision: Hybrid approach.** Deterministic loop for routine coordination. LLM orchestrator only for ambiguous decisions (decomposition, conflict resolution, priority changes). |
| TUI dashboard | GAP | **Decision: Build terminal dashboard** (blessed/ink) with file polling + inotify for real-time updates. |
| State storage migration path | N/A | **Decision: JSONL now, SQLite later.** Design SessionManager to be storage-agnostic. |

---

## Security Remediations (from security audit)

| Finding | Severity | Decision |
|---------|----------|----------|
| Desktop notifier command injection | CRITICAL | **Redesign with safe APIs**: terminal-notifier (macOS), notify-send (Linux), proper escaping (Windows) |
| Dynamic plugin loading | HIGH | **Allowlist + escape hatch**: @ultracoder/* trusted by default. Custom plugins require `--allow-custom-plugins` flag |
| tmux quoting | HIGH | Fixed in Codex review pass (shellQuote function added) |
| SSRF via Slack webhook | MEDIUM | Validate webhook URL matches `https://hooks.slack.com/services/*` |
| Path traversal in session IDs | MEDIUM | Validate session IDs at CLI boundary against `/^[a-f0-9]{8}$/` |
| Agent output parsing | NEW | **Deep integration** with version-pinned parsers for Claude Code stream-json format |

---

## Status Counts

| Status | Count |
|--------|-------|
| MATCH | 24 |
| DEVIATION | 8 |
| GAP | 14 |
| PLACEHOLDER | 5 |
| PARTIAL | 5 |
| NEW (from interview) | 8 |

---

## Recommended Next Steps (Priority Order)

### Immediate — Correctness Foundation
1. Add hallucination-detection regex patterns to veracity Tier 1 ("I've created", "successfully built", "I ran the command")
2. Add git-diff-based filesystem cross-check as veracity Tier 1b
3. Build heuristic rules engine for tool policy "evaluate" tier (network boundary, scope containment, resource limits)
4. Implement version-pinned parser for Claude Code stream-json (deep agent integration)

### High Priority — 12-State Lifecycle
5. Expand state machine to 12 DevOps-integrated states
6. Add batched GraphQL calls for PR/CI/review detection to lifecycle worker
7. Add time-based escalation with timestamps + timers + persistence to reactions
8. Add retry count tracking to reactions
9. Add lightweight intent classification (heuristic, based on tool patterns)

### Medium Priority — Parallel Execution
10. Implement task decomposition via agent CLI delegation
11. Persist scope tracker state to JSONL
12. Add structured handoff protocol with metrics
13. Implement git merge execution in merge queue (kill-rebase-respawn strategy)
14. Wire reconciler to real tsc+build+test execution
15. Build finalization loop (3 corrective sweeps)

### Lower Priority — Polish & UX
16. Build TUI dashboard (blessed/ink) with file polling + inotify
17. Implement hybrid orchestrator (deterministic loop + LLM for ambiguous decisions)
18. Move cost tracking pricing to config-driven model
19. Add plugin allowlist + escape hatch security
20. Redesign desktop notifier with safe APIs
21. Implement hybrid auto-resume (context file + git diff + original task)
22. Add `uc watch` and `uc logs` commands
23. Design storage-agnostic SessionManager for future SQLite migration
