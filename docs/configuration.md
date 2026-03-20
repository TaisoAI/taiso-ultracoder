# Configuration

Ultracoder uses YAML configuration files. Settings are loaded from the first file found in this search order:

1. Explicit path via `--config` flag
2. Project directory: `ultracoder.yaml`, `ultracoder.yml`, `.ultracoder.yaml`, `.ultracoder.yml`
3. Home directory: `~/.ultracoder/ultracoder.yaml`

If no config file is found, defaults are used with the project ID derived from the directory name.

**Note:** Ultracoder also walks up the directory tree from the current working directory, checking each parent directory for a config file. This allows nested projects to inherit configuration from a parent project.

## Full Reference

```yaml
# Required: unique project identifier
projectId: my-project

# Required: path to the project root (relative to config file or absolute)
rootPath: .

# Default branch for the project
defaultBranch: main  # default: "main"

# Storage backend: "file" (JSONL, default) or "sqlite" (future)
storageBackend: file  # default: "file"

# LLM endpoint configuration (weighted routing)
llm:
  endpoints:
    - url: https://api.anthropic.com
      weight: 80   # 80% of requests
      apiKey: ${ANTHROPIC_API_KEY}
    - url: https://openrouter.ai/api
      weight: 20   # 20% of requests
      apiKey: ${OPENROUTER_API_KEY}

# Session configuration
session:
  agent:
    # Agent type: "claude-code" or "codex"
    type: claude-code  # default: "claude-code"

    # Model to use (passed to the agent CLI)
    model: claude-sonnet-4-5-20250514  # optional

    # Max tokens for agent responses
    maxTokens: 8192  # optional

    # Session timeout in seconds
    timeout: 3600  # default: 3600 (1 hour)

    # Extra environment variables for the agent process
    env: {}  # default: {}

  quality:
    veracity:
      enabled: true         # default: true
      tier: regex            # "regex", "llm", or "both" — default: "regex"

    toolPolicy:
      enabled: true          # default: true
      defaultTier: evaluate  # "auto", "evaluate", "human", "blocked" — default: "evaluate"
      evaluateRules:
        maxFileSize: 1048576     # 1MB — max file size for writes
        maxFilesModified: 100    # max files modified per session
        maxSubprocessMs: 300000  # 5 min — max subprocess runtime

    gates:
      lint: true             # default: true
      test: true             # default: true
      typecheck: true        # default: true

    reviewer:
      enabled: false         # default: false
      model: ~               # optional: model for the reviewer agent

  # Reaction escalation thresholds
  reactions:
    ci_fail:
      maxRetries: 2            # escalate after 2 retries
      escalateAfterMs: 1800000 # escalate after 30 minutes
    conflict:
      maxRetries: 1
      escalateAfterMs: 900000  # 15 minutes
    stuck:
      maxRetries: 1
      escalateAfterMs: 600000  # 10 minutes

  # Max concurrent sessions per lifecycle worker cycle
  maxConcurrent: 4  # default: 4

  # Global spawn limit — enforced at the spawn pipeline
  # Prevents resource exhaustion by rejecting new spawns when limit is reached
  maxConcurrentSessions: 10  # default: 10

  # Auto-resume on context exhaustion
  autoResume: true  # default: true

  # Cooldown before auto-resume (seconds)
  cooldownSeconds: 30  # default: 30

# Trusted custom plugins (outside @ultracoder/* namespace)
# By default only @ultracoder/* packages are loaded
trustedPlugins: []  # e.g. ["my-custom-runtime-plugin"]

# Plugin configuration
plugins:
  runtime:
    package: "@ultracoder/plugin-runtime-tmux"
    config:
      tmuxPath: tmux  # path to tmux binary

  agent:
    package: "@ultracoder/plugin-agent-claude-code"
    config:
      claudePath: claude  # path to claude binary

  workspace:
    package: "@ultracoder/plugin-workspace-worktree"
    config: {}

  tracker:
    package: "@ultracoder/plugin-tracker-github"
    config:
      ghPath: gh  # path to GitHub CLI

  scm:
    package: "@ultracoder/plugin-scm-github"
    config:
      ghPath: gh

  notifier:
    package: "@ultracoder/plugin-notifier-desktop"
    config: {}

# Issue monitoring (auto-triage and fix)
issueMonitor:
  enabled: false               # default: false
  pollIntervalMs: 60000        # default: 60000 (1 minute)
  filter:
    labels: ["bug"]            # Only monitor issues with these labels
    excludeLabels: ["wontfix"] # Skip issues with these labels
    state: open                # "open", "closed", or "all" — default: "open"
    assignee: ~                # Filter by assignee (optional)
    query: ~                   # GitHub search query (optional)
  assessorAgentPath: claude    # Path to agent CLI for assessments — default: "claude"
  assessorTimeoutMs: 180000    # 3 min per assessment — default: 180000
  synthesizerModel: ~          # Model for synthesis step (optional)
  maxEffort: medium            # Reject issues above this effort — optional
  maxConcurrentAssessments: 2  # default: 2
  maxConcurrentSpawns: 3       # default: 3

# Workspace strategy
workspace:
  strategy: worktree  # "worktree" or "clone" — default: "worktree"
  basePath: ~         # optional: custom base path for workspaces

# Notification settings
notifications:
  desktop: true  # default: true
  slack:
    enabled: false
    webhook: ~  # Slack webhook URL
```

## Per-Project Overrides

Place an `ultracoder.yaml` in any subdirectory to override settings for that subtree. Settings are merged with the project-level config, with the more specific config taking precedence.

## Environment Variables

The agent process inherits the current environment plus any variables from `session.agent.env`. Common variables to set:

```yaml
session:
  agent:
    env:
      ANTHROPIC_API_KEY: sk-ant-...
      OPENAI_API_KEY: sk-...
```

**Security note:** Avoid committing API keys in config files. Use environment variables or a secrets manager instead.
