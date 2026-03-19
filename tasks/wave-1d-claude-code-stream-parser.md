# Task: Implement version-pinned parser for Claude Code stream-json

## Priority: Immediate | Wave: 1D (parallel with 1A, 1B, 1C)

## Description
Deep integration with Claude Code requires parsing its `--output-format stream-json` output. Build a versioned parser that extracts tool_use events, file edits, bash commands, and conversation turns.

## Acceptance Criteria
- New `ClaudeStreamParser` class in agent-claude-code plugin
- Parses Claude Code stream-json lines into typed events:
  - `assistant` messages (text content)
  - `tool_use` events (tool name, input args — Read, Write, Edit, Bash, Glob, Grep, etc.)
  - `tool_result` events (output, is_error)
  - `system` events (context window, token usage)
- Version detection from stream metadata (parser v1 for current Claude Code format)
- Schema-tolerant: unknown fields are ignored, missing optional fields don't crash
- Fallback: if parsing fails for a line, emit a generic "active" activity event + log parse warning
- `parseActivity()` in the plugin uses ClaudeStreamParser to produce rich AgentActivity events
- Activity types expanded: `tool_call` includes tool name, `file_edit` includes path, `bash_command` includes command
- Tests with sample Claude Code stream-json fixtures

## Files to Create/Modify
- `packages/plugins/agent-claude-code/src/stream-parser.ts` — New ClaudeStreamParser class
- `packages/plugins/agent-claude-code/src/index.ts` — Update parseActivity to use parser
- `packages/plugins/agent-claude-code/src/stream-parser.test.ts` — Tests with fixtures
- `packages/core/src/types.ts` — Expand AgentActivity with richer event types

## Dependencies
None — can run in parallel with other Wave 1 tasks.
