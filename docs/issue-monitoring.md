# Issue Monitoring

Automatically triage GitHub issues using dual-agent assessment, synthesize a resolution plan, and spawn a coding agent to implement the fix.

## Overview

The issue monitoring pipeline:

```
1. Poll GitHub for new issues (configurable filter)
2. Two agents assess independently (Claude Opus 4.6 + Codex, in parallel)
3. Both assessments posted as comments on the GitHub issue
4. Orchestrator synthesizes a unified resolution plan from both assessments
5. Coding agent spawns to implement the fix
6. PR opened for human review
```

## Configuration

```yaml
issueMonitor:
  enabled: true
  pollIntervalMs: 60000          # Poll every 60 seconds
  filter:
    labels: ["bug", "uc:autofix"]
    excludeLabels: ["wontfix", "question"]
    state: open                  # open, closed, or all
    assignee: ""                 # Filter by assignee (optional)
    query: ""                    # GitHub search query (optional)
  assessorAgentPath: claude      # Path to agent CLI for assessments
  assessorTimeoutMs: 180000      # 3-minute timeout per assessment
  maxEffort: medium              # Reject issues above this effort level
  maxConcurrentAssessments: 2    # Max issues being assessed at once
  maxConcurrentSpawns: 3         # Max fix sessions running at once
```

## CLI Commands

```bash
# Start the issue monitor (runs in foreground with polling loop)
uc monitor start

# Show configuration and all tracked issues
uc monitor status

# Manually trigger dual assessment for a specific issue
uc monitor assess 42

# Stop monitoring (Ctrl+C or stop the orchestrator)
uc monitor stop
```

## Issue State Machine

Each tracked issue progresses through a state machine:

```
seen → assessing → assessed → planning → spawning → spawned
  ↓        ↓           ↓          ↓          ↓
error   error       rejected    error      error
  ↓
seen  (retry)
```

| State | Description |
|-------|-------------|
| `seen` | Issue discovered, waiting for assessment slot |
| `assessing` | Dual assessment in progress (Claude + Codex) |
| `assessed` | Both assessments complete, ready for synthesis |
| `planning` | Resolution plan synthesized, ready to spawn |
| `spawning` | Fix session being created |
| `spawned` | Fix session running (terminal state) |
| `rejected` | Issue filtered out (effort too high, etc.) |
| `error` | Transient failure (auto-recoverable) |

## Dual Assessment

Two agents assess each issue independently and in parallel:

1. **Claude Opus 4.6** analyzes the issue, identifies root cause, proposes a fix
2. **Codex** independently analyzes the same issue

Each assessment produces:
- **Severity** (critical / high / medium / low)
- **Effort** (trivial / small / medium / large)
- **Root cause** analysis
- **Proposed fix** approach
- **Related files** that need modification
- **Confidence** level (0-1)

Both assessments are posted as comments on the GitHub issue for transparency.

### Graceful Degradation

If one agent fails, the pipeline continues with the single available assessment. Only if both agents fail does the issue move to `error` state for retry.

## Synthesis

A third LLM call reads the issue body plus both assessments and produces a unified resolution plan:

- Where the assessments agree (high-confidence approach)
- Where they disagree (noted with rationale for chosen approach)
- Specific files and functions to change
- Test changes needed
- Scope boundaries (what NOT to change)

## Effort Filtering

The `maxEffort` config filters out issues that are too complex for automated fixing:

```yaml
issueMonitor:
  maxEffort: medium   # Only auto-fix trivial, small, and medium issues
```

Effort is evaluated using the worst-case assessment across all available agents. If either agent rates the effort above the threshold, the issue is rejected.

## Stale Recovery

Records stuck in `assessing` state for longer than 2x the assessment timeout are automatically reset to `seen` for retry. This handles agent crashes, network timeouts, and other transient failures.

## Orchestrator Integration

The issue monitor integrates with the orchestrator via the `pollIssues` callback. When the orchestrator is running (`uc start`), issue polling happens automatically as part of each orchestration cycle.

```typescript
// In your orchestrator setup:
const monitor = new IssueMonitor(deps, config.issueMonitor);
await monitor.init();

const orchestrator = new Orchestrator(deps, {
  pollSessions: ...,
  processMergeQueue: ...,
  runReconciler: ...,
  pollIssues: () => monitor.poll(),  // Integrated into orchestrator cycle
});
```

## GitHub Comment Format

Each assessment is posted as a formatted comment:

```markdown
## Assessment by claude-opus-4-6

**Severity:** high | **Effort:** small | **Confidence:** 0.85

### Root Cause
Missing null check in the request handler when the user payload is empty.

### Proposed Fix
Add a guard clause at the top of handleRequest() that returns 400 for empty payloads.

### Related Files
- `src/handlers/request.ts`
- `src/middleware/validation.ts`

---
*Generated by Ultracoder issue monitor*
```

## Persistence

Issue records are stored as JSON files in `~/.ultracoder/projects/{hash}/issues/` using the `KVStore` utility. Each issue gets its own file, writes are atomic, and the store survives crashes.
