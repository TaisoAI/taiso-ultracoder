# Task: Security hardening (notifier, plugins, session IDs, Slack webhook)

## Priority: Lower | Wave: 4C (parallel with 4A, 4B, 4D)

## Description
Address critical and high security findings from the audit.

## Acceptance Criteria
- Desktop notifier: use terminal-notifier on macOS, notify-send on Linux, properly escaped PowerShell on Windows (no string interpolation)
- Plugin loading: allowlist @ultracoder/* by default. Custom plugins require `trustedPlugins` in config or `--allow-custom-plugins` flag. Log warning.
- Session ID validation: CLI commands validate session IDs against `/^[a-f0-9]{8}$/` before passing to session manager
- Slack webhook: validate URL matches `https://hooks.slack.com/services/*` pattern. Reject non-HTTPS.
- Branch name validation: reject names starting with `-`, validate against `/^[a-zA-Z0-9][a-zA-Z0-9._\/-]*$/`
- Tests for each security fix

## Files to Modify
- `packages/plugins/notifier-desktop/src/index.ts` — Rewrite notification dispatch
- `packages/core/src/plugin-registry.ts` — Add allowlist check
- `packages/cli/src/commands/send.ts`, `kill.ts`, `status.ts` — Add session ID validation
- `packages/plugins/notifier-slack/src/index.ts` — Add URL validation
- `packages/cli/src/commands/spawn.ts` — Add branch name validation
