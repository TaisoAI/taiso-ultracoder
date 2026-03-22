# Architecture

## Design Principles

Ultracoder synthesizes patterns from four open-source projects, following these principles:

1. **Plugin-first** (from Agent Orchestrator) — Every external integration is a swappable slot with a defined interface
2. **Inline verification** (from tcagent) — Quality is checked inline, not eventually. Veracity + tool policy + gates run before code lands
3. **Parallel when beneficial** (from Longshot) — Decompose large tasks with scope isolation. Serialize merging with conflict resolution
4. **Append-only persistence** (from pi-autoresearch) — JSONL event logs. Reconstruct state on startup. Survive any crash
5. **React to DevOps lifecycle** (from Agent Orchestrator) — Auto-handle CI failures, review comments, merge readiness
6. **Dependency injection everywhere** (from Longshot) — Every external dependency is injectable for deterministic testing

## Package Relationships

```
┌─────────────────────────────────────────────────────┐
│                    @ultracoder/cli                    │
│  Commands: init, spawn, send, status, kill, approve,  │
│  deny, approvals, cleanup, doctor, monitor, web       │
└────────────────────┬────────────────────────────────┘
                     │ uses
┌────────────────────▼────────────────────────────────┐
│               @ultracoder/core                       │
│  Types, Plugin Registry, Session Manager,            │
│  State Machine, Spawn Pipeline, Prompt Builder,      │
│  Event Bus (21 types), Notification Router,          │
│  Adaptive LLM Router, Config, Paths, Logger, Utils   │
└──┬────────┬────────┬────────┬────────┬──────────────┘
   │        │        │        │        │  depended on by
   ▼        ▼        ▼        ▼        ▼
┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────────┐ ┌────┐
│qualit│ │lifecy│ │parall│ │issue-│ │observabil│ │web │
│  y   │ │  cle │ │  el  │ │monit.│ │   ity    │ │    │
│      │ │      │ │      │ │      │ │          │ │Hook│
│Verac.│ │13-st.│ │Scope │ │Dual  │ │Tracing   │ │API │
│Policy│ │React.│ │Merge │ │Assess│ │Cost      │ │SSE │
│Approv│ │Quest.│ │Recon.│ │Synth.│ │Recovery  │ │Dash│
│Gates │ │Intent│ │Replan│ │Spawn │ │          │ │    │
│Review│ │Resume│ │Confl.│ │      │ │          │ │    │
└──────┘ └──────┘ └──────┘ └──────┘ └──────────┘ └────┘
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
    ┌──────────┐ ┌────────┐ ┌────────┐
    │ Plugins  │ │Plugins │ │Plugins │
    │ runtime  │ │ agent  │ │  scm   │
    │ tmux     │ │ claude │ │ github │
    │ process  │ │ codex  │ │        │
    └──────────┘ └────────┘ └────────┘
```

## Data Flow

### Session Lifecycle

```
1. CLI: uc spawn "task"
   → SessionManager.create() → status: "spawning"
   → runSpawnPipeline() — shared pipeline with concurrency guard:
     → Check maxConcurrentSessions limit (excludes current session)
     → WorkspacePlugin.create() → git worktree
     → AgentPlugin.buildCommand() → claude -p "task" --output-format stream-json
     → RuntimePlugin.spawn() → tmux new-session
     → SessionManager.update() → status: "working"
   → On failure: session set to "failed", error thrown

2. Lifecycle Worker (every 30s):
   → sessions.list({ status: [all active statuses] }) → single batch query
   → For each session:
     → detectActivity(session.logs) → { isCompleted, isStuck, intent }
     → If completed: canTransition("working", "open_pr") → status: "pr_open"
     → If stuck: evaluateReaction("stuck", meta) → action

3. SCM Integration:
   → ScmPlugin.getPRStatus() → { state, reviewDecision, ciStatus }
   → Lifecycle transitions: pr_open → review_pending → approved → mergeable → merged

4. Issue Monitor (optional, per issue):
   → IssueMonitor.poll() → tracker.listIssues() → new issues
   → DualAssessor: Claude + Codex assess in parallel
   → tracker.addComment(issueId, assessment) → posted to GitHub
   → Synthesizer: LLM merges assessments → resolution plan
   → Spawner: creates session with full pipeline (workspace + agent + runtime)

5. Quality Pipeline (per session):
   → checkVeracityRegex(output) → hallucination findings
   → checkVeracityFilesystem(workspace) → git diff verification
   → evaluateToolPolicy(tool, args) → allow/block decision
   → runGates(projectPath) → lint/test/typecheck results
   → reviewDiff(diff) → approve/request_changes verdict
```

## Plugin Architecture

### 7 Slots

Each slot has a TypeScript interface in `@ultracoder/core/types.ts`. Plugins implement the interface and export a `create(config)` factory function.

```typescript
// Plugin structure
export function create(config: MyConfig): RuntimePlugin {
  return {
    meta: { name: "my-plugin", slot: "runtime", version: "1.0.0" },
    async spawn(opts) { ... },
    async kill(handle) { ... },
    async isAlive(handle) { ... },
    async sendInput(handle, input) { ... },
  };
}
export default create;
```

### Dynamic Loading

Plugins are loaded dynamically via `import(packageName)`. The registry handles:
- Graceful degradation on load/init failure (failing plugin removed, others continue)
- One plugin per slot (later registration replaces earlier)
- Lifecycle management (initAll/destroyAll)

### Plugin Security

`@ultracoder/*` packages are trusted by default. Custom plugins require explicit opt-in via `trustedPlugins` config or `--allow-custom-plugins` flag.

## State Management

### Current: Flat Files + JSONL

- **Session metadata**: JSON files with atomic writes (temp file + rename)
- **Event history**: Append-only JSONL logs
- **Configuration**: YAML with Zod schema validation
- **Observability**: NDJSON span files

### Future: SQLite Migration Path

The `SessionManager` interface is storage-agnostic. A SQLite implementation can be swapped in without changing callers. JSONL remains the source of truth; SQLite would serve as a queryable index.

## Dependency Injection

The `Deps` container provides all services:

```typescript
interface Deps {
  config: ProjectConfig;
  logger: Logger;
  plugins: PluginRegistry;
  sessions: SessionManager;
  paths: PathResolver;
}
```

All major classes accept `Deps` or individual services. Tests inject fakes via `vi.fn()` — no monkeypatching.

## Deep Agent Integration

### Claude Code Stream Parser

The `agent-claude-code` plugin includes a version-pinned parser (`ClaudeStreamParser`) for Claude Code's `--output-format stream-json` output:

- Parses 6 event types: `assistant_text`, `tool_use`, `tool_result`, `system`, `error`, `unknown`
- Extracts tool names, arguments, outputs, error flags, token usage
- Schema-tolerant: unknown fields ignored, partial data accepted, malformed lines return null
- Feeds into intent classification: tool_use events map to activity patterns

### Intent Classification

Heuristic classifier maps tool usage patterns to 8 intent types (exploring, planning, implementing, testing, debugging, reviewing, committing, idle). Returns intent + confidence score + evidence string.

## Security Model

- **Tool policy**: 4-tier approval with heuristic rules for the evaluate tier (network boundaries, scope containment, resource limits)
- **Plugin allowlist**: Only `@ultracoder/*` packages loaded by default; custom plugins require `trustedPlugins` config
- **Session ID validation**: CLI validates against `/^[a-f0-9]{8}$/` pattern
- **Issue/PR ID validation**: Numeric-only validation (`/^\d+$/`) on all GitHub tracker and SCM plugin methods, preventing argument injection
- **Atomic writes**: Temp file + rename prevents partial writes
- **Safe numeric parsing**: `retryCount` and other metadata fields validated at runtime; experiment CLI options use `Number.isFinite` guards
- **Shell quoting**: tmux plugin uses POSIX single-quote escaping for arguments
- **Concurrency limits**: `maxConcurrentSessions` enforced at the spawn pipeline to prevent resource exhaustion
