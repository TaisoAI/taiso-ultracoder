# Quality Pipeline

The quality pipeline validates agent output before it's merged. It runs five stages in sequence, each independently configurable.

## Pipeline Stages

```
Agent Output → [Veracity Regex] → [Filesystem Cross-check] → [Tool Policy] → [Quality Gates] → [Reviewer] → Pass/Fail
```

## Stage 1a: Veracity — Hallucination Detection (Regex)

Scans agent output text for common hallucination patterns. Zero-cost, always runs.

### Execution Claim Patterns

These catch agents that claim to have done something without actually doing it:

| Pattern | Example Match |
|---------|--------------|
| Creation claims | "I've created the file", "I created a new module" |
| Success claims | "successfully built", "successfully compiled", "successfully installed" |
| Execution claims | "I ran the command", "I executed the test suite" |
| Completeness claims | "all files in place", "all tests pass", "everything is working" |
| Update claims | "I've updated the config", "I've modified the handler" |
| Passive change claims | "the file has been updated", "the changes have been applied" |

### Metadata Patterns

| Pattern | Example Match |
|---------|--------------|
| Unverified imports | `import foo from "nonexistent-package"` |
| URL references | `https://github.com/example/repo` |
| Version claims | "as of version 3.2.1" |
| Deprecation claims | "deprecated since v2.0" |

### False Positive Prevention

All hallucination patterns use a negative lookbehind `(?<!["'\`])` to avoid matching inside string literals, template literals, or code comments.

```yaml
session:
  quality:
    veracity:
      enabled: true
      tier: regex    # "regex", "llm", or "both"
```

## Stage 1b: Veracity — LLM Grounding (Optional)

When configured with `tier: "llm"` or `tier: "both"`, a second LLM call verifies whether the agent's output is grounded in reality. The grounding agent receives the task context and workspace path alongside the agent output, and returns a structured verdict with any ungrounded claims identified.

```yaml
session:
  quality:
    veracity:
      enabled: true
      tier: both          # "regex", "llm", or "both"
      llm:
        agentPath: claude  # path to agent CLI
        timeoutMs: 120000  # 2 minutes
```

When `tier: "both"`, regex and LLM results are merged. LLM failures degrade gracefully — a warning is logged and the pipeline continues with regex-only results.

## Stage 1c: Veracity — Filesystem Cross-check

After the agent claims completion, verifies that files actually changed by running `git diff --name-only` and `git status --porcelain` in the workspace.

- If `claimedFiles` are provided: each claimed file must appear in the diff. Missing files produce severity `"error"` findings.
- If no `claimedFiles`: reports all actually-changed files as informational findings.
- Gracefully handles non-git directories.

This is the "ground truth" layer — regex catches suspicious claims, filesystem cross-check confirms them.

## Stage 2: Tool Policy (4-Tier)

Controls which tools agents are allowed to use.

| Tier | Behavior |
|------|----------|
| `auto` | Tool runs without intervention |
| `evaluate` | Heuristic rules engine checks safety (see below) |
| `human` | Requires human approval before running |
| `blocked` | Cannot run under any circumstances |

### Default Rules

| Pattern | Tier | Reason |
|---------|------|--------|
| `bash:rm *` | human | Destructive file operation |
| `bash:git push*` | human | Pushes to remote |
| `bash:git reset*` | human | Destructive git operation |
| `bash:curl*` | evaluate | Network request |
| `bash:wget*` | evaluate | Network request |
| `write:*.env*` | blocked | Secrets file |
| `write:*credentials*` | blocked | Credentials file |

### Evaluate Tier: Heuristic Rules Engine

When a tool invocation hits the `evaluate` tier, three categories of heuristic rules are checked:

**Network Boundary Rules**
- Block requests to RFC 1918 IPs (10.x, 172.16-31.x, 192.168.x)
- Block link-local addresses (169.254.x)
- Block localhost/127.x
- Require HTTPS for external URLs (block plain HTTP)

**Scope Containment Rules**
- Block file writes outside the session's workspace path
- If assigned scope is set, block writes to files not in scope
- Detect path traversal attempts (`../`)

**Resource Limit Rules**
- Max file size per write (default: 1MB)
- Max files modified per session (default: 100)
- Max subprocess runtime (default: 5 minutes)

```yaml
session:
  quality:
    toolPolicy:
      enabled: true
      defaultTier: evaluate
      evaluateRules:
        maxFileSize: 1048576      # 1MB
        maxFilesModified: 100
        maxSubprocessMs: 300000   # 5 min
```

### Custom Rules

```yaml
session:
  quality:
    toolPolicy:
      rules:
        - pattern: "bash:deploy*"
          tier: blocked
          reason: "No production deploys from agents"
        - pattern: "bash:npm publish*"
          tier: human
          reason: "Package publishing requires approval"
```

## Stage 3: Quality Gates

Auto-detects and runs your project's lint, test, and typecheck commands in parallel.

Detection order:
- **Lint:** `pnpm lint` → `npm run lint` → `npx biome check .`
- **Test:** `pnpm test` → `npm test`
- **Typecheck:** `pnpm typecheck` → `npx tsc --noEmit`

Each gate has a 5-minute timeout. Gates run in parallel via `Promise.all`.

```yaml
session:
  quality:
    gates:
      lint: true
      test: true
      typecheck: true
```

## Stage 4: Reviewer Agent

Optional second AI instance in read-only mode that reviews the agent's diff.

Produces structured verdicts:
- **approve** — Changes look good
- **request_changes** — Issues found (blocks the pipeline)
- **comment** — Suggestions but not blocking

```yaml
session:
  quality:
    reviewer:
      enabled: true
      model: claude-sonnet-4-5-20250514
```

## Pipeline Result

The pipeline produces a combined result:

```typescript
interface QualityPipelineResult {
  passed: boolean;
  veracity: VeracityFinding[];
  filesystemVeracity: VeracityFinding[];
  toolPolicyDecisions: ToolPolicyDecision[];
  gates?: GatesResult;
  review?: ReviewVerdict | null;
  errors: string[];
}
```

The pipeline passes only if ALL conditions are met:
- No veracity findings with severity "error"
- No filesystem findings with severity "error"
- All tool invocations allowed by policy
- All quality gates pass
- Reviewer does not request changes
- No stage errors
