# Observability

Monitor agent activity, track costs, and recover from failures.

## Structured Tracing

All operations emit NDJSON (newline-delimited JSON) spans for structured observability.

### Spans

Each span captures a unit of work:

```json
{
  "traceId": "550e8400-e29b-41d4-a716-446655440000",
  "spanId": "a1b2c3d4",
  "parentSpanId": null,
  "name": "session.spawn",
  "startTime": "2025-01-15T10:30:00.000Z",
  "endTime": "2025-01-15T10:30:01.234Z",
  "durationMs": 1234,
  "attributes": { "sessionId": "abc12345", "agentType": "claude-code" },
  "status": "ok"
}
```

### Creating Spans

```typescript
import { createSpan, endSpan, writeSpan } from "@ultracoder/observability";

const span = createSpan("my-operation", {
  attributes: { key: "value" },
});

// ... do work ...

const completed = endSpan(span, "ok");  // or "error"
await writeSpan("traces.jsonl", completed);
```

### Aggregating Metrics

```typescript
import { readSpans, aggregateSpans } from "@ultracoder/observability";

const spans = await readSpans("traces.jsonl");
const metrics = aggregateSpans(spans);

// metrics = {
//   totalSpans: 150,
//   errorCount: 3,
//   avgDurationMs: 2500,
//   maxDurationMs: 15000,
//   spansByName: { "session.spawn": 10, "quality.gates": 30, ... }
// }
```

## Cost Tracking

Track token usage and costs per session, per model.

### Recording Costs

```typescript
import { calculateCost, recordCost } from "@ultracoder/observability";

const cost = calculateCost("claude-sonnet-4-5-20250514", inputTokens, outputTokens);
await recordCost("costs.jsonl", {
  sessionId: "abc12345",
  timestamp: new Date().toISOString(),
  model: "claude-sonnet-4-5-20250514",
  inputTokens: 5000,
  outputTokens: 2000,
  cost,
  currency: "USD",
});
```

### Supported Pricing Models

| Model | Input (per 1M) | Output (per 1M) |
|-------|----------------|-----------------|
| claude-sonnet-4-5-20250514 | $3.00 | $15.00 |
| claude-opus-4-5-20250514 | $15.00 | $75.00 |
| gpt-4o | $2.50 | $10.00 |
| o3 | $10.00 | $40.00 |

### Budget Enforcement

Set per-session cost limits:

```typescript
import { isWithinBudget } from "@ultracoder/observability";

const result = isWithinBudget(currentSessionCost, {
  maxPerSession: 5.00,  // $5 per session
  maxPerDay: 50.00,     // $50 per day
  currency: "USD",
});

if (!result.allowed) {
  // Pause or kill the session
}
```

### Cost Summaries

```typescript
import { summarizeCosts } from "@ultracoder/observability";

const summary = await summarizeCosts("costs.jsonl");
// summary = {
//   totalCost: 12.34,
//   totalInputTokens: 500000,
//   totalOutputTokens: 200000,
//   entriesByModel: { "claude-sonnet-4-5-20250514": { cost: 10.00, count: 5 } },
//   entriesBySession: { "abc12345": 3.50, "def67890": 8.84 }
// }
```

## Recovery System

The recovery system performs automated health checks and corrective actions.

### How It Works

1. **Scan** — Lists all sessions
2. **Validate** — Diagnoses each session's health
3. **Act** — Executes corrective actions (or reports in dry-run mode)
4. **Report** — Returns a summary of actions taken

### Diagnosis Rules

| Condition | Action |
|-----------|--------|
| Running with no PID or runtime | Archive (orphaned) |
| Pending for over 1 hour | Archive (stale) |
| Failed with retries < 3 | Restart |
| Failed with retries >= 3 | Archive |

### Dry-Run Mode

Preview recovery actions without executing them:

```typescript
import { runRecovery } from "@ultracoder/observability";

const report = await runRecovery(deps, { dryRun: true });
// report = {
//   scannedCount: 10,
//   actions: [
//     { sessionId: "abc", action: "archive", reason: "Orphaned session" },
//     { sessionId: "def", action: "restart", reason: "Failed session: retry 1/3" },
//   ],
//   dryRun: true,
// }
```

### Error Isolation

Recovery actions are isolated per-session. If one session's recovery fails, the rest continue normally.
