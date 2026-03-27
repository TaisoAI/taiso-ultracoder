# Getting Started

## Prerequisites

- **Node.js 20+** — [Download](https://nodejs.org)
- **pnpm 9+** — `npm install -g pnpm`
- **git** — Already installed on most systems
- **An AI coding agent** — Claude Code (`claude`) or OpenAI Codex (`codex`) CLI installed
- **tmux** (optional) — `brew install tmux` (macOS) or `apt install tmux` (Linux). Only needed when using `runtime-tmux` plugin. On Windows, use `runtime-process` instead.

## Installation

```bash
git clone https://github.com/taiso-ai/ultracoder.git
cd ultracoder
pnpm install
pnpm build
```

Link the CLI globally:

```bash
pnpm link --global packages/cli
```

Verify the installation:

```bash
uc doctor
```

This checks that all dependencies are available.

## Initialize Your Project

Navigate to the project you want to manage with Ultracoder:

```bash
cd ~/my-project
uc init
```

This creates `ultracoder.yaml` with sensible defaults. Edit it to match your setup:

```yaml
projectId: my-project
rootPath: .
defaultBranch: main

session:
  agent:
    type: claude-code
  quality:
    gates:
      lint: true
      test: true
      typecheck: true

workspace:
  strategy: worktree
```

## Spawn Your First Agent

```bash
uc spawn "Add input validation to the user registration form"
```

This will:
1. Create a session record with a unique ID
2. Create an isolated workspace (git worktree by default)
3. Start the configured agent (Claude Code by default)
4. The agent works autonomously on the task

## Monitor Progress

```bash
# List all sessions
uc status

# Get details on a specific session
uc status -s abc12345

# Output as JSON (for scripting)
uc status --json

# Live terminal dashboard with session status, costs, warnings
uc dashboard

# Stream live session output
uc watch abc12345

# View session logs
uc logs abc12345
```

## Send Follow-up Instructions

```bash
uc send abc12345 "Also add server-side validation, not just client-side"
```

## Start, Stop, and Batch Operations

```bash
# Resume a spawning or failed session
uc start abc12345

# Gracefully pause a working session
uc stop abc12345

# Spawn multiple sessions from a task file
uc batch-spawn tasks.yaml
```

## Finish Up

When you're done with a session:

```bash
# Kill and archive
uc kill abc12345

# Clean up old sessions (older than 7 days)
uc cleanup

# Clean up all completed sessions
uc cleanup --all
```

## Auto-Triage Issues

Enable the issue monitor to automatically assess and fix GitHub issues:

```bash
# Start monitoring (after enabling in ultracoder.yaml)
uc monitor start

# Check what's being tracked
uc monitor status

# Manually assess a specific issue
uc monitor assess 42
```

See [Issue Monitoring](./issue-monitoring.md) for full configuration and workflow details.

## Next Steps

- [Issue Monitoring](./issue-monitoring.md) — Dual-agent triage, synthesis, auto-fix pipeline
- [Configuration Guide](./configuration.md) — Full config reference
- [Plugins](./plugins.md) — Available plugins and how to configure them
- [Quality Pipeline](./quality-pipeline.md) — Veracity, tool policy, and quality gates
- [Lifecycle Management](./lifecycle.md) — 13-state machine, reactions, escalation, auto-resume
- [Parallel Execution](./parallel-execution.md) — Running multiple agents safely
- [Observability](./observability.md) — Tracing, cost tracking, recovery
- [Architecture](./architecture.md) — Design principles, package relationships, data flow
