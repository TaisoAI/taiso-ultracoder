# Lifecycle Management

Ultracoder manages the full lifecycle of agent sessions through a 13-state DevOps-integrated state machine with configurable reactions, escalation thresholds, and intent classification.

## Session States (13)

```
spawning → working → pr_open → review_pending → approved → mergeable → merged → archived
                ↓         ↓              ↓           ↓           ↓
             failed   ci_failed   changes_requested  ci_failed  merge_conflicts
                ↓         ↓              ↓                         ↓
             (retry)   (resolve)      (resolve)                 (resolve)
                          ↓              ↓                         ↓
                       working        working                   working
```

| State | Description |
|-------|-------------|
| `spawning` | Session created, workspace being set up |
| `working` | Agent is actively coding |
| `pr_open` | Agent finished, PR opened |
| `review_pending` | PR awaiting review |
| `ci_failed` | CI checks failed on the PR |
| `changes_requested` | Reviewer requested changes |
| `merge_conflicts` | Branch has merge conflicts |
| `approved` | PR approved by reviewer |
| `mergeable` | CI green + approved, ready to merge |
| `merged` | PR merged to default branch |
| `failed` | Generic agent failure (crash, error) |
| `killed` | Manually terminated |
| `archived` | Moved to archive storage (terminal) |

## State Machine

Transitions are validated as exact `(from, event)` pairs. A semantically wrong event is rejected even if the target state would be reachable by a different event.

### Events (14)

| Event | Target State | Description |
|-------|-------------|-------------|
| `start` | working | Begin agent work |
| `open_pr` | pr_open | Agent completed, open PR |
| `request_review` | review_pending | Request review on PR |
| `ci_pass` | mergeable | CI checks passed |
| `ci_fail` | ci_failed | CI checks failed |
| `approve` | approved | Reviewer approved |
| `request_changes` | changes_requested | Reviewer requested changes |
| `conflict` | merge_conflicts | Merge conflict detected |
| `resolve` | working | Return to working (retry/fix) |
| `make_mergeable` | mergeable | Manual mergeable override |
| `merge` | merged | PR merged |
| `kill` | killed | Manual termination |
| `archive` | archived | Move to archive |
| `fail` | failed | Generic failure |

### Valid Transitions Per State

| From | Valid Events |
|------|-------------|
| spawning | start, kill |
| working | open_pr, fail, kill |
| pr_open | request_review, ci_fail, conflict, kill |
| review_pending | approve, request_changes, ci_fail, kill |
| ci_failed | resolve, kill, archive |
| changes_requested | resolve, kill, archive |
| merge_conflicts | resolve, kill, archive |
| approved | ci_pass, make_mergeable, ci_fail, kill |
| mergeable | merge, conflict, kill |
| merged | archive |
| failed | start, kill, archive |
| killed | archive |
| archived | (terminal — no events) |

## Reaction Engine

The lifecycle worker detects events and triggers configurable reactions with escalation.

### Triggers and Default Actions

| Trigger | Default Action | Escalation |
|---------|---------------|------------|
| `ci_fail` | Notify | After 2 retries or 30 min → escalate to human |
| `review_requested` | Notify | No escalation |
| `conflict` | Pause (→ merge_conflicts) | After 1 retry or 15 min → escalate |
| `stuck` | Resume with fresh context | After 1 retry or 10 min → escalate |
| `completed` | Notify | No escalation |

### Escalation Configuration

Configure per-trigger thresholds in `ultracoder.yaml`:

```yaml
session:
  reactions:
    ci_fail:
      maxRetries: 2           # Escalate after this many retries
      escalateAfterMs: 1800000  # Escalate after 30 minutes
    conflict:
      maxRetries: 1
      escalateAfterMs: 900000   # 15 minutes
    stuck:
      maxRetries: 1
      escalateAfterMs: 600000   # 10 minutes
```

Escalation uses both mechanisms:
- **Retry count**: Stored in session metadata as `retryCount`. Incremented on each retry. When count >= maxRetries → escalate.
- **Time-based**: Stored as `firstDetectedAt` timestamp. When elapsed time > escalateAfterMs → escalate.
- Both are persisted in session metadata for resilience across worker restarts.

### Reaction Actions

| Action | Behavior |
|--------|----------|
| `notify` | Send notification via notifier plugin |
| `pause` | Transition to merge_conflicts state |
| `retry` | Transition back to working |
| `kill` | Terminate the session |
| `escalate` | Notify human for manual intervention |
| `resume` | Requires manual handling (logged) |

## Lifecycle Worker

The worker runs as a background polling loop checking all `working` sessions every 30 seconds.

### Detection Steps

1. **Agent activity** — Parse JSONL activity logs for last event
2. **Stuck detection** — Check if idle time exceeds threshold (default: 5 minutes)
3. **Completion** — If agent reports completed, transition to `pr_open`

### Poll Overlap Guard

The worker uses a `pollInProgress` flag to prevent overlapping polls when a cycle takes longer than the poll interval.

```yaml
# Worker configuration
pollIntervalMs: 30000    # 30 seconds
maxIdleMs: 300000        # 5 minutes before stuck detection
enabled: true
```

## Intent Classification

The lifecycle package includes a lightweight heuristic intent classifier that categorizes what the agent is doing based on tool usage patterns. No LLM needed.

### Intent Types

| Intent | Detection Rule |
|--------|---------------|
| `idle` | No events or all events are idle |
| `exploring` | Majority of events are Read/Grep/Glob tool calls |
| `testing` | Bash commands matching test/pytest/vitest/jest/mocha |
| `committing` | Bash commands matching git commit/add/push |
| `debugging` | Error event followed by Read tool call |
| `implementing` | Majority of events are Write/Edit tool calls |
| `planning` | Default fallback when no dominant pattern |

### Usage

Intent is automatically included in `ActivitySummary`:

```typescript
const summary = await detectActivity(logPath);
// summary.intent = { intent: "implementing", confidence: 0.8, evidence: "6/10 events are Write/Edit" }
```

## Auto-Resume

When an agent hits context window limits or crashes, auto-resume handles recovery:

1. Chooses correct recovery event based on state (`resolve` for error states, `start` for failed)
2. Validates transition is legal
3. Applies cooldown period (default: 30 seconds)
4. Re-reads session state after cooldown (guards against stale data)
5. Validates transition is still legal
6. Increments retry counter (with safe numeric parsing)
7. Transitions back to `working`

Configuration:

```yaml
session:
  autoResume: true
  cooldownSeconds: 30
```

Auto-resume respects a max retry limit (default: 3). After exceeding retries, the session stays in its error state for manual intervention.

## Recovery System

The recovery system performs periodic health sweeps:

1. **Scan** — Lists all sessions
2. **Diagnose** — Checks for orphaned sessions (working with no PID/runtime), stale spawning sessions (>1 hour), failed sessions eligible for retry
3. **Act** — Archives orphaned/stale sessions, restarts failed sessions (up to 3 retries)
4. **Report** — Returns summary of actions taken

Supports `dryRun: true` to preview actions without executing.

Each recovery action is isolated — one failing action doesn't abort the sweep.
