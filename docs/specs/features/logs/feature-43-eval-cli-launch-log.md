---
status: waiting
updated: 2026-03-15T22:41:45.366Z
startedAt: 2026-03-11T22:31:13+11:00
completedAt: 2026-03-11T22:32:59+11:00
autonomyRatio: 0.00
---

# Implementation Log: Feature 43 - eval-cli-launch

## Plan

Replicate the auto-launch pattern from `feature-implement` into `feature-eval`. When run from a plain shell, detect no active agent session and spawn the configured agent CLI with the eval prompt.

## Progress

- Added `evalPrompt` field to all 4 agent configs (cc, gg, cx, cu)
- Extended `getAgentCliConfig` to read `evalPrompt` from global and project config overrides
- Replaced `printAgentContextWarning` call in `feature-eval` with full detect + auto-launch block
- Added `--agent` flag support for choosing which agent evaluates
- Flags (`--allow-same-model-judge`, `--force`) are passed through to the spawned agent's prompt
- Added 6 unit tests for evalPrompt resolution logic
- All 36 tests pass

## Decisions

- Used `implementFlag` (not a new `evalFlag`) for agent launch flags since eval uses the same permission mode as implement
- Default evaluator is `cc` when no `--agent` is specified (matches existing convention)
- evalPrompt defaults to `/aigon:feature-eval {featureId}` if not set in agent config, so the feature works even without config updates
