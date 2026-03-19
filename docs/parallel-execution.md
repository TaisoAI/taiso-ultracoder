# Parallel Execution

Run multiple agents simultaneously on related tasks without merge conflicts.

## Overview

The parallel execution system has four components:

1. **Task Decomposer** — Breaks large tasks into parallelizable subtasks
2. **Scope Tracker** — Prevents file ownership conflicts
3. **Merge Queue** — Serializes branch merges with retry logic
4. **Reconciler** — Health sweeps and corrective actions

## Task Decomposition

The decomposer takes a large task and breaks it into subtasks that can run in parallel:

```typescript
const result = await decomposeTask(
  "Refactor the authentication module",
  { files: ["src/auth/login.ts", "src/auth/register.ts", ...] }
);

// result.subtasks = [
//   { id: "sub-1", title: "Refactor login flow", scope: ["src/auth/login.ts"] },
//   { id: "sub-2", title: "Refactor registration", scope: ["src/auth/register.ts"] },
// ]
// result.executionOrder = [["sub-1", "sub-2"]]  // Can run in parallel
```

Each subtask gets:
- A unique ID
- A title and description
- A list of files in its scope (for conflict prevention)
- Dependencies on other subtasks
- A priority level

## Scope Tracking

The scope tracker ensures no two agents modify the same files:

```typescript
const tracker = new ScopeTracker();

// Agent 1 claims auth files
tracker.acquire("session-1", ["src/auth/login.ts", "src/auth/utils.ts"]);

// Agent 2 tries to claim overlapping files — gets conflict
const conflict = tracker.acquire("session-2", ["src/auth/utils.ts"]);
// conflict === "session-1"

// Agent 2 claims non-overlapping files — succeeds
tracker.acquire("session-2", ["src/api/routes.ts"]);
```

### File Handoff

When one agent finishes with a file and another needs it:

```typescript
executeHandoff(tracker, {
  fromSession: "session-1",
  toSession: "session-2",
  files: ["src/auth/utils.ts"],
  reason: "Auth refactor complete, API needs the utils",
});
```

Handoffs are atomic — either all files transfer or none do.

## Merge Queue

The merge queue serializes branch merges to prevent conflicts:

```typescript
const queue = new MergeQueue(logger);

// Add completed branches
queue.enqueue({ sessionId: "s1", branch: "fix/login-bug", priority: 3 });
queue.enqueue({ sessionId: "s2", branch: "feat/new-api", priority: 1 });

// Process in priority order (highest first)
const next = queue.dequeue();  // s1 (priority 3)
```

Features:
- **Priority ordering** — Higher priority branches merge first
- **Retry logic** — Failed merges retry up to 3 times
- **Strategy fallback** — Tries squash → rebase → merge in order

## Reconciler

The reconciler performs health sweeps across all active sessions:

```typescript
const result = await reconcile(
  activeSessions,
  async (session) => ({
    sessionId: session.id,
    healthy: true,
    issues: [],
  }),
  logger,
);
```

It suggests corrective actions based on detected issues:
- Stuck agents → trigger auto-resume
- Merge conflicts → pause and notify
- Crashes → restart session
- Resource exhaustion → scale down parallel sessions

## Best Practices

1. **Keep scopes small** — Smaller file scopes mean less conflict potential
2. **Use priorities** — Critical fixes should merge before features
3. **Monitor the merge queue** — A growing queue indicates too many parallel agents
4. **Set maxConcurrent** — Don't spawn more agents than your machine can handle

```yaml
session:
  maxConcurrent: 4  # Recommended: CPU cores / 2
```
