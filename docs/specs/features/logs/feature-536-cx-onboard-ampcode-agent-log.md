# Implementation Log: Feature 536 - onboard-ampcode-agent
Agent: cx

## Status

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: cc (Claude Code, Opus 4.7)
**Date**: 2026-05-25

### Fixes Applied
- None — implementation was clean

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- None

### Notes
- `buildModelArgTokens` helper correctly centralises the model-flag-to-agent-flag mapping; all three foreground launch paths (`entity-commands.js`, `feature-do.js`, `feature-eval.js`) now use it instead of hardcoded `['--model', model]`.
- am.json is well-structured; quarantine on `large` mode is correct per spec. Complexity defaults (low→rush, medium→smart, high/very-high→deep) are sensible.
- Two remaining `--model` references in `lib/aigon-eval-runner.js` and `lib/perf-bench.js` are aigon CLI arguments (not agent launch args), so they don't need the registry lookup — the translation happens downstream in the command handlers.
- Observation: foreground launch paths for TUI-inject agents without a `promptFlag` (am, km) append the prompt as a bare positional arg. This is pre-existing for km and the primary path is tmux — noting for future awareness, not a regression.
- Implementation log sections (Status, Key Decisions, Gotchas, etc.) were left unpopulated by the implementer.
