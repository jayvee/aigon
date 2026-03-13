---
status: implementing
updated: 2026-03-13T05:36:00.000Z
---

# Implementation Log: Feature 54 - config-models-global-resolution
Agent: cx

## Plan
- Locate the model provenance resolver used by `aigon config models`.
- Update resolution to include global/project config at `agents.<agent>.<task>.model`.
- Preserve precedence: env > project > global > template.
- Add regression tests covering provenance resolution and source labels in CLI output.

## Progress
- Ran `aigon feature-do 54` in this worktree and confirmed scope.
- Identified bug in `lib/utils.js:getModelProvenance()`: it only read legacy keys `agents.<agent>.models.<task>`.
- Updated resolver to support canonical key shape `agents.<agent>.<task>.model` (with backward-compatible fallback to legacy shape).
- Added CLI-level regression tests in `aigon-cli.test.js` that spawn `aigon config models` in isolated temp dirs and assert:
  - global config values resolve with `global` source
  - project config overrides global with `project` source
  - env var overrides project/global with `env` source
- Ran `npm test`:
  - New config-model tests pass.
  - Two pre-existing worktree helper tests still fail due repo-prefixed tmux naming expectations (unrelated to this feature).

## Decisions
- Kept backward compatibility for legacy config shape while prioritizing the canonical documented key path.
- Used integration-style CLI tests (rather than unit-only mocks) to validate rendered `config models` output and `SOURCE` column behavior end-to-end.
