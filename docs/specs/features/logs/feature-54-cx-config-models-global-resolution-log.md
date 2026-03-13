---
status: submitted
updated: 2026-03-13T05:51:12.755Z
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

## Additional Progress (Runtime Resolution)
- Verified a remaining gap: runtime command construction (`buildResearchAgentCommand` / `getAgentCliConfig`) still ignored canonical overrides and used template models.
- Added shared helper `getConfigModelValue(config, agentId, taskType)` and reused it in both:
  - `getModelProvenance()` (display path)
  - `getAgentCliConfig()` (runtime command path)
- Added regression tests asserting runtime command model resolution precedence for canonical keys:
  - global canonical override applied
  - project canonical override beats global
  - env override beats project/global

## Verification
- Ran `npm test` after runtime-resolution updates.
- Result: 39 passed, 2 failed, 41 total.
- Failing tests are pre-existing and unrelated to this feature:
  - `Worktree Helpers > buildTmuxSessionName includes repo and unpadded ID`
  - `Worktree Helpers > buildTmuxSessionName defaults agent to solo`

## Submission Notes
- Feature implementation commits are already present on this branch:
  - `65795b3` `fix: resolve config models from global task-level model keys`
  - `b6050c5` `fix: apply canonical model overrides to runtime agent command resolution`
  - `316502c` `docs: update implementation log for feature 54`
  - `4f3d7fe` `docs: mark feature 54 submission status`
- Current working tree contains only local `.env.local` edits, which were intentionally not included in feature commits.
- Implementation is ready for cross-agent evaluation.
