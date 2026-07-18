# Implementation Log: Feature 683 - rendered-agent-template-zero-opinion-guard
Agent: cu

## Status

Stack-neutral agent placeholders + profile-conditioned dev-server note; shared leak-rules module scans source, placeholders, and generic-profile rendered installs.
## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: cc
**Date**: 2026-07-18

### Fixes Applied
- None — implementation was clean.

### Validation
- Validation not run by reviewer per policy.

### Escalated Issues (exceptions only)
- None.

### Notes
- Verified the placeholder-merge precedence change in `resolveAgentDocPlaceholders` is safe: the agent-doc template (`generic/docs/agent.md`) only consumes `AGENT_DEV_SERVER_NOTE`, `AGENT_ID`, `AGENT_PITFALLS`, `AGENT_TITLE`, `CMD_PREFIX`, `PERMISSION_SAVE_NOTE`; no profile-placeholder resolver emits any of these except `AGENT_DEV_SERVER_NOTE`, which is deliberately blanked when dev-server support is off. So unrelated agent placeholder precedence is preserved.
- Confirmed the guard is not vacuous: `.aigon/docs/agents/*.md` is recorded in `install-manifest.json` (`recordFile`), and `scanRenderedManifestFiles` reads `manifest.files[].path`, so the rendered scan actually scans the file that carried the original leak.
- Coverage is correctly layered: under `generic` the note is blanked (rendered scan can't see a reintroduced raw-JSON leak), but `scanAgentPlaceholderFiles` scans the raw placeholder strings directly, closing that gap. Web-profile output is intentionally not scanned per spec.
- `scanRenderedManifestFiles` resolves and confines every scanned path under the fixture root. Guards wired into `test:core` (static + integration) and `prepublishOnly` (rendered); iterate gate untouched. `check-module-graph` passes with the two new `lib/` modules.
- Non-blocking: the implementation log body (New API Surface / Key Decisions / Gotchas / Test Coverage sections) was left empty by the implementer.
