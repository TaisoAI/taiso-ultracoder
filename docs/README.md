# Ultracoder Documentation

## Guides

| Document | Description |
|----------|-------------|
| [Getting Started](./getting-started.md) | Installation, prerequisites, first session walkthrough |
| [Configuration](./configuration.md) | Full YAML config reference with all options and defaults |
| [Architecture](./architecture.md) | Design principles, package relationships, data flow, security model |

## Core Concepts

| Document | Description |
|----------|-------------|
| [Quality Pipeline](./quality-pipeline.md) | 5-stage verification: veracity regex, filesystem cross-check, tool policy, quality gates, AI reviewer |
| [Lifecycle](./lifecycle.md) | 13-state DevOps state machine, reaction engine with escalation, intent classification, auto-resume |
| [Parallel Execution](./parallel-execution.md) | Task decomposition, scope tracking, merge queue, reconciler, finalization |
| [Observability](./observability.md) | NDJSON tracing, per-session cost tracking, budget enforcement, recovery system |

## Reference

| Document | Description |
|----------|-------------|
| [Plugins](./plugins.md) | All 11 plugins across 7 slots, configuration examples, custom plugin authoring guide |

## Quick Links

- [CLI Commands](./getting-started.md#spawn-your-first-agent) — 13 commands: init, spawn, start, stop, send, status, kill, batch-spawn, watch, logs, dashboard, cleanup, doctor
- [Session States](./lifecycle.md#session-states-13) — Full 13-state transition table
- [Tool Policy Rules](./quality-pipeline.md#evaluate-tier-heuristic-rules-engine) — Network boundary, scope containment, resource limit rules
- [Reaction Thresholds](./lifecycle.md#escalation-configuration) — Configurable escalation timing and retry counts
- [Plugin Slots](./plugins.md#plugin-slots-7) — runtime, agent, workspace, tracker, scm, notifier, reviewer
