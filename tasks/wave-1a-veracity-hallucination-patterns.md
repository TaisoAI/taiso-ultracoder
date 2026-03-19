# Task: Add hallucination-detection regex patterns to veracity Tier 1

## Priority: Immediate | Wave: 1A (parallel with 1B, 1C, 1D)

## Description
The veracity checker currently only detects metadata issues (imports, URLs, versions). It does NOT catch the primary tcagent use case: execution claims where agents say they did something they didn't.

## Acceptance Criteria
- Add regex patterns for hallucinated execution claims:
  - "I've created", "I created", "I have created"
  - "successfully built", "successfully compiled", "successfully installed"
  - "I ran the command", "I executed", "I ran"
  - "all files in place", "all tests pass", "everything is working"
  - "I've updated", "I've modified", "I've added"
  - "the file has been", "the changes have been"
- Each pattern has a descriptive message and severity "warn"
- Existing tests still pass
- New tests cover each pattern category
- No false positives on code content (patterns should be anchored to agent prose, not code strings)

## Files to Modify
- `packages/quality/src/veracity.ts` — Add patterns to HALLUCINATION_PATTERNS array
- `packages/quality/src/veracity.test.ts` — Add tests for new patterns

## Dependencies
None — can run in parallel with other Wave 1 tasks.
