# OpenShell Review: Relevance to Ultracoder

Source: https://github.com/NVIDIA/OpenShell

## What is OpenShell?

OpenShell is a **sandboxed runtime for autonomous AI agents**, written primarily in Rust. It provides isolated execution environments that protect a developer's data, credentials, and infrastructure from untrusted or semi-trusted AI agent code. The core problem it solves: when you let an AI agent (Claude Code, Codex, OpenCode, GitHub Copilot, etc.) write and execute code on your behalf, you need guardrails -- network egress control, filesystem isolation, process restrictions, and credential management -- so the agent cannot exfiltrate data, access unauthorized services, or damage your system.

It is currently in alpha ("single-player mode" -- one developer, one environment) and is Apache 2.0 licensed.

## Architecture

The system runs **K3s (lightweight Kubernetes) inside a single Docker container** on the developer's machine (or a remote host). The workspace is organized as a Rust workspace with 10 crates:

| Crate | Purpose |
|---|---|
| `openshell-cli` | CLI tool (`openshell`) -- all user-facing commands |
| `openshell-tui` | Terminal UI (`openshell term`) -- k9s-inspired dashboard |
| `openshell-server` | Gateway/control plane -- gRPC + HTTP server |
| `openshell-sandbox` | Sandbox supervisor -- runs inside each sandbox pod |
| `openshell-policy` | OPA/Rego policy engine (via `regorus`, in-process) |
| `openshell-router` | Inference routing -- rewrites/proxies LLM API calls |
| `openshell-providers` | Provider credential discovery plugins |
| `openshell-core` | Shared types, protobuf definitions, config, utilities |
| `openshell-bootstrap` | Gateway lifecycle orchestration (deploy, stop, destroy) |
| `openshell-ocsf` | OCSF (Open Cybersecurity Schema Framework) event logging |

There is also a **Python SDK** (`python/openshell/`) for programmatic sandbox management.

Key architectural flow:
- **CLI/SDK/TUI** communicate with the **Gateway** over gRPC with mTLS
- **Gateway** manages sandbox lifecycle through Kubernetes CRDs, persists state in SQLite/Postgres
- **Sandbox pods** each run a supervisor process that enforces policy via Landlock, seccomp, network namespaces, and an HTTP CONNECT proxy with OPA evaluation
- **SSH tunneling** through the gateway provides interactive shell access and file sync

## Key Features

### Agent/LLM Integration

- **Built-in agent support**: Claude Code, OpenCode, Codex, GitHub Copilot, Openclaw -- detected automatically from the command passed to `sandbox create`
- **Inference routing** (`inference.local`): All agent LLM API calls are intercepted via a TLS MITM proxy. Supports OpenAI, Anthropic, and NVIDIA NIM API protocols. Routes are configured cluster-wide via `openshell inference set --provider <name> --model <id>`. Request rewriting (auth headers, model IDs, base URLs) is transparent. Supports streaming, mock routes for testing, and self-hosted inference (LM Studio, vLLM)
- **Provider system**: Credential plugins for Claude, Codex, OpenCode, Openclaw, GitHub, GitLab, NVIDIA, Outlook. Auto-discovers API keys from environment variables and config files
- **Credential placeholder resolution**: Agent processes never see real API keys. They receive placeholders like `openshell:resolve:env:ANTHROPIC_API_KEY`. The supervisor's proxy rewrites these to real values only at the network boundary

### Sandboxing (Multi-Layer Isolation)

1. **Linux Landlock**: Filesystem access control -- restricts which directories the agent can read/write via read-only and read-write allowlists
2. **Seccomp BPF**: System call filtering -- restricts which syscalls the agent process can make
3. **Network namespaces**: Each sandbox gets an isolated network namespace with a veth pair. All agent traffic is forced through an HTTP CONNECT proxy
4. **HTTP CONNECT Proxy with OPA policy**: Every outbound connection is evaluated against Rego policies. Process identity binding via `/proc` inspection. SSRF protection against private IP ranges
5. **TLS MITM** (optional): Per-sandbox ephemeral CA, dynamic leaf certificate generation per hostname, enables HTTP-level policy evaluation
6. **Privilege dropping**: Supervisor runs as root; agent processes run as a restricted user

### Policy System

- Declarative YAML policies compiled to OPA/Rego
- `filesystem`: read-only and read-write directory allowlists
- `process`: run-as-user/group configuration
- `network_policies`: named rules with endpoints (host globs, ports, L7 rules), binary identity restrictions, TLS handling, enforcement mode (enforce/audit)
- Hot-reloadable at runtime (10-second poll interval)
- **Policy Advisor**: Observes denied connections, auto-generates draft `NetworkPolicyRule` proposals deterministically, user reviews via CLI or TUI with approve/reject

### Shell/Terminal/Process Management

- **Interactive SSH access**: PTY-backed SSH tunneled through gateway via HTTP CONNECT
- **Command execution**: CLI-side or gateway-side (gRPC `ExecSandbox`)
- **File sync**: tar-over-SSH bidirectional transfer (upload/download)
- **Port forwarding**: SSH tunnels with foreground/background modes and auto-cleanup
- **TUI**: ratatui-based terminal dashboard with sandbox table, network rules panel, vim-style navigation

### Persistence and Session Management

- **Gateway persistence**: SQLite (default) or Postgres. Object types: sandbox, provider, ssh_session, inference_route
- **SSH session management**: Short-lived tokens (24h TTL), per-token and per-sandbox connection limits, background reaper, nonce replay detection
- **Sandbox lifecycle**: Provisioning -> Ready -> Deleting (with Error state). Real-time streaming via `WatchSandbox` gRPC

### Additional

- **Python SDK** with `exec_python()`: Serialize a callable via cloudpickle, execute inside sandbox
- **GPU passthrough**: Full NVIDIA GPU support via Docker -> k3s -> device plugin -> pod resources
- **Cloudflare-fronted deployments**: Browser login relay and WebSocket tunneling for remote access
- **Editor SSH integration**: Installs `Host openshell-<name>` in `~/.ssh/config` for VSCode Remote SSH
- **Community sandboxes**: Maintained at `ghcr.io/nvidia/openshell-community/sandboxes/`

---

## Relevance to Ultracoder

### Directly Useful (high leverage)

| OpenShell Feature | Ultracoder Benefit |
|---|---|
| **Sandboxed agent execution** | Replace tmux/process runtime plugins with OpenShell sandboxes. Agents get filesystem isolation, network policy, and credential protection instead of running with full user permissions |
| **Credential placeholder resolution** | Agents never see real API keys. Currently ultracoder passes `session.agent.env` with raw secrets. OpenShell's proxy-level resolution is strictly safer |
| **Network egress policies (OPA/Rego)** | Maps directly to ultracoder's tool policy `evaluate` tier. OpenShell's per-binary, per-host policy with SSRF protection is far richer than ultracoder's heuristic rules |
| **Inference routing** | OpenShell intercepts all LLM calls at `inference.local` and routes them via config. Could replace/complement ultracoder's `llm-router.ts` -- adds credential rotation, provider-agnostic routing, and request rewriting |
| **Policy advisor (auto-generated rules from denials)** | No equivalent in ultracoder. Would let the tool policy tier learn from observed agent behavior instead of relying on static heuristic rules |

### Worth Adopting as a Plugin

| Feature | How to Integrate |
|---|---|
| **`plugin-runtime-openshell`** | New runtime plugin that creates/destroys OpenShell sandboxes instead of tmux sessions. Would use the Python SDK or gRPC API. Each `uc spawn` creates a sandbox, `uc kill` destroys it |
| **File sync (tar-over-SSH)** | Replace git worktree workspace plugin for remote execution scenarios. `--upload` pushes code, agent works in sandbox, download pulls results |
| **Port forwarding** | Useful for agents running dev servers or test suites that bind ports. No equivalent in ultracoder today |

### Complementary (different layer, no overlap)

| Feature | Assessment |
|---|---|
| **K3s/Kubernetes infra** | Operational concern -- ultracoder doesn't need to reimplement this, just consume it via the runtime plugin |
| **TUI dashboard** | OpenShell's ratatui dashboard is cluster-focused. Ultracoder's dashboard is session/task-focused. Different concerns |
| **SSH/PTY management** | Useful for `uc watch` and `uc send` if running in sandboxes, but the SSH plumbing stays inside the runtime plugin |
| **GPU passthrough** | Relevant for ML experiment workloads but not core orchestration |

### Not Applicable

| Feature | Why |
|---|---|
| **TLS MITM for L7 inspection** | Overkill for local dev. Useful in enterprise/compliance contexts |
| **Cloudflare-fronted deployments** | Infrastructure concern outside ultracoder's scope |
| **OCSF security logging** | Enterprise audit requirement, not needed for the orchestrator |

---

## Recommended Next Steps

1. **Create `plugin-runtime-openshell`** -- This is the highest-leverage integration. A new runtime plugin that wraps OpenShell's sandbox create/exec/destroy. This gives ultracoder agents filesystem isolation and network policy enforcement with minimal changes to the core.

2. **Replace raw env var passing with credential placeholders** -- Instead of `session.agent.env: { ANTHROPIC_API_KEY: sk-ant-... }`, use OpenShell's placeholder pattern where real keys are resolved at the proxy boundary.

3. **Adopt OPA/Rego for tool policy evaluate tier** -- OpenShell's policy engine is more expressive than ultracoder's heuristic rules. Could either embed a JS Rego evaluator or call out to the OpenShell policy engine.

4. **Add inference routing config to `ultracoder.yaml`** -- If agents run inside OpenShell sandboxes, the LLM routing happens at the sandbox layer via `inference.local`. Ultracoder's `llm-router.ts` would configure OpenShell routes rather than routing directly.

The biggest win is #1 -- it turns ultracoder's local-only tmux sessions into properly sandboxed execution environments with credential protection and network control, which addresses several security gaps identified in the gaps analysis.
