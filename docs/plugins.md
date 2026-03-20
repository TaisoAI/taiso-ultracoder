# Plugins

Ultracoder uses a 7-slot plugin architecture. Each slot serves a specific role, and you can swap implementations to fit your infrastructure.

## Plugin Slots

| Slot | Purpose | Available Plugins |
|------|---------|-------------------|
| `runtime` | Spawn and manage agent processes | `runtime-tmux`, `runtime-process` |
| `agent` | Build agent CLI commands, parse output | `agent-claude-code`, `agent-codex` |
| `workspace` | Create isolated workspaces | `workspace-worktree`, `workspace-clone` |
| `tracker` | Issue tracking | `tracker-github` |
| `scm` | PRs, CI, merge operations | `scm-github` |
| `notifier` | Notifications | `notifier-desktop`, `notifier-slack` |
| `reviewer` | Automated code review | Built-in (quality package) |

## Runtime Plugins

### runtime-tmux (recommended)

Spawns agents in tmux sessions. Allows detaching and reattaching to running agents.

```yaml
plugins:
  runtime:
    package: "@ultracoder/plugin-runtime-tmux"
    config:
      tmuxPath: tmux  # optional: path to tmux binary
```

**Requirements:** tmux installed and available in PATH.

**Usage:** Each session gets a named tmux session (`uc-<id>`). You can attach manually with `tmux attach -t uc-<id>`.

### runtime-process

Spawns agents as child processes. Simpler but no reattach capability.

```yaml
plugins:
  runtime:
    package: "@ultracoder/plugin-runtime-process"
    config: {}
```

No external dependencies required.

## Agent Plugins

### agent-claude-code (default)

Builds commands for Anthropic's Claude Code CLI.

```yaml
plugins:
  agent:
    package: "@ultracoder/plugin-agent-claude-code"
    config:
      claudePath: claude   # optional: path to claude binary
```

**Generated command:** `claude -p "<task>" --output-format stream-json`

Parses Claude's stream-JSON output to detect activity states (idle, active, tool calls, completion).

### agent-codex

Builds commands for OpenAI's Codex CLI.

```yaml
plugins:
  agent:
    package: "@ultracoder/plugin-agent-codex"
    config:
      codexPath: codex  # optional: path to codex binary
```

**Generated command:** `codex --task "<task>"`

## Workspace Plugins

### workspace-worktree (recommended)

Creates git worktrees for each session. Fast, shares the git object database.

```yaml
plugins:
  workspace:
    package: "@ultracoder/plugin-workspace-worktree"
    config:
      basePath: .worktrees  # optional: base directory for worktrees
```

**How it works:** Runs `git worktree add -b <branch> <path>` to create an isolated copy. Cleanup runs `git worktree remove`.

### workspace-clone

Full git clone per session. Slower but fully isolated.

```yaml
plugins:
  workspace:
    package: "@ultracoder/plugin-workspace-clone"
    config:
      basePath: /tmp/uc-clones  # optional: base directory for clones
```

## Tracker & SCM Plugins

### tracker-github

Manages GitHub issues via the `gh` CLI.

```yaml
plugins:
  tracker:
    package: "@ultracoder/plugin-tracker-github"
    config:
      ghPath: gh  # optional
```

**Operations:** Create issues, update issues, get issue details, list issues (with label/state/assignee filters), add comments.

### scm-github

Manages GitHub PRs and CI via the `gh` CLI.

```yaml
plugins:
  scm:
    package: "@ultracoder/plugin-scm-github"
    config:
      ghPath: gh  # optional
```

**Operations:** Create PRs, check PR status, merge PRs, get CI status.

## Notifier Plugins

### notifier-desktop

Sends native desktop notifications.

```yaml
plugins:
  notifier:
    package: "@ultracoder/plugin-notifier-desktop"
    config: {}
```

**Platform support:**
- macOS: Uses `osascript` (AppleScript)
- Linux: Uses `notify-send`
- Windows: Uses PowerShell `New-BurntToastNotification`

### notifier-slack

Sends notifications to a Slack channel via webhook.

```yaml
plugins:
  notifier:
    package: "@ultracoder/plugin-notifier-slack"
    config:
      webhookUrl: https://hooks.slack.com/services/T.../B.../xxx
```

## Writing Custom Plugins

Each plugin must export a `create(config)` function that returns an object implementing the appropriate plugin interface:

```typescript
import type { RuntimePlugin, RuntimeSpawnOpts, RuntimeHandle } from "@ultracoder/core";

export function create(config: MyConfig): RuntimePlugin {
  return {
    meta: {
      name: "my-runtime",
      slot: "runtime",
      version: "1.0.0",
    },

    async spawn(opts: RuntimeSpawnOpts): Promise<RuntimeHandle> {
      // Your implementation
    },

    async kill(handle: RuntimeHandle): Promise<void> {
      // Your implementation
    },

    async isAlive(handle: RuntimeHandle): Promise<boolean> {
      // Your implementation
    },

    async sendInput(handle: RuntimeHandle, input: string): Promise<void> {
      // Your implementation
    },
  };
}

export default create;
```

Register it in your config:

```yaml
plugins:
  runtime:
    package: "./my-plugins/my-runtime"
    config:
      myOption: value
```
