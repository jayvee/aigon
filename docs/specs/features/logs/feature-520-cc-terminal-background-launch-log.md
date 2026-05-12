---
commit_count: 4
lines_added: 545
lines_removed: 55
lines_changed: 600
files_touched: 15
fix_commit_count: 1
fix_commit_ratio: 0.25
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: true
input_tokens: 79
output_tokens: 41724
cache_creation_input_tokens: 196563
cache_read_input_tokens: 6187815
thinking_tokens: 0
total_tokens: 6426181
billable_tokens: 41803
cost_usd: 16.0978
sessions: 1
model: "claude-opus-4-7"
tokens_per_line_changed: null
---
# Implementation Log: Feature 520 - terminal-background-launch
Agent: cc

## Status

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: composer (Cursor agent)
**Date**: 2026-05-12

### Fixes Applied

- `f71fa98c` — `fix(review): revert unrelated scope bleed on feature 520 branch` (restored deleted release skill / changelog-entry script / feature-507 artifacts; reverted `.scan/state.json`, `.gitignore`, `package-lock.json`, and erroneous `feature-autonomous.js` edits that removed approved-review fast-path handling)

### Validation

- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)

- **ESCALATE:ambiguous** — Spec Open Questions propose “Open” should always foreground while Acceptance Criteria say focus-existing remains a no-op when `background=true`; behaviour implemented follows the AC / focus-existing bullets. Product owner should resolve if dashboard “Open” must force foreground via a separate code path.

### Notes

- Core F520 plumbing (`terminal.focusOnLaunch`, `wrapBackgroundAppleScript`, Warp `open -g`, dashboard settings schema entry, `openTerminalAppWithCommand` threading) looks coherent; unit tests cover defaults and merge precedence.
- Ghostty CLI fallback cannot honour background mode (documented); AppleScript paths do.
