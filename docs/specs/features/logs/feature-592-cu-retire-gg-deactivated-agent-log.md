---
commit_count: 5
lines_added: 475
lines_removed: 1030
lines_changed: 1505
files_touched: 80
fix_commit_count: 1
fix_commit_ratio: 0.2
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
model: "cursor"
source: "no-telemetry-cursor"
---
# Implementation Log: Feature 592 - retire-gg-deactivated-agent
Agent: cu

## Status
Implemented deactivated-agent registry (`active: false`), retired `gg` (records-only), routed launchable vs all-known enumerators, removed Gemini budget polling and live capture hooks.
## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: cc (Sonnet 4.6)
**Date**: 2026-06-25

### Fixes Applied
- a218d80d9 fix(review): close gaps in gg retirement — missed enumerators, broken batch installs, stale docs
  - `lib/onboarding/detectors.js`: `getAgentDetectors()` used `getAllAgents()` — the onboarding wizard's install picker and `aigon doctor` still offered/flagged the deactivated `gg` agent. Switched to `getLaunchableAgents()`.
  - `lib/spec-recommendation.js`: `buildRecommendationPayload()` used `getAllAgents()`, feeding `gg` (no `cli.complexityDefaults`) into the dashboard start-modal recommendation API (`/api/recommendation/:type/:id`) and crashing a pre-existing test that read `gg.cli.complexityDefaults`. Switched to `getLaunchableAgents()`.
  - `lib/commands/misc.js` (`rollout`) and `lib/agent-instructions-regen.js`: both hardcoded `.gemini/` into a `git add` pathspec list. `git add` is fatal (exit 128, no files staged at all) when any pathspec matches nothing, and `install-agent --all` no longer creates `.gemini/` now that `gg` is excluded from the launchable set — both would silently fail their entire batch commit on every repo going forward. Removed `.gemini/` from both lists.
  - `lib/commands/misc.js` `detectAgents()` (rollout) also pushed `'gg'` into the agent list passed to `install-agent`; since `install-agent` now refuses the *entire* batch when any requested agent is deactivated, this voided the whole rollout for any repo with a legacy `.gemini/settings.json` — `cc`/`cu`/`cx` would never get reinstalled either. Removed the `gg` detection.
  - `scripts/reset-fixture.js` (`/seed-reset`): same batch-abort issue — `install-agent cc gg` would silently no-op for brewboard/trailhead seed repos. Swapped to `cc ag` and updated the config model overrides.
  - `docker/clean-room/smoke-test.sh`: `install-agent cc gg` smoke step swapped to `cc ag` so it exercises something real again (the old assertion's `|| true` pattern meant it would "pass" either way, silently losing coverage).
  - `tests/unit/settings-scope-api.test.js`: wrote `defaultAgent: 'gg'` at project scope — now rejected by the launchable-only `options` list with a 400, but the test's loose assertion (`!== 'scope_violation'`) still passed for the wrong reason. Swapped to `'cu'`.
  - `tests/unit/spec-recommendation.test.js`: fixed the now-crashing `gg.cli.complexityDefaults` access (swapped loop to `ag`) and added a regression test asserting `gg` is excluded from the recommendation payload.
  - Docs: `AGENTS.md`, `docs/architecture.md`, `docs/adding-agents.md`, `CONTRIBUTING.md`, `templates/help.txt`, `templates/generic/commands/feature-open.md`, `templates/generic/commands/research-open.md` — removed/replaced literal `aigon install-agent cc gg`-style examples (now fail) and corrected the Slash-command vs File-prompt categorization (`ag` is File-prompt type like `cx`, not slash-invocable like `gg` was).

### Validation
- Validation not run by reviewer per policy

### Escalated Issues
- ESCALATE:blocked — `scripts/test/e2e-docker.sh`, `scripts/test/build-auth-snapshot.sh` still install/auth `gemini` CLI and run a live feature with `gg` as the agent (`install-agent cc gg` then `run_feature 09 gg ...`). Both will now fail (install-agent batch-aborts; feature-start refuses `gg`). Fixing correctly requires swapping to `agy`'s curl-based install and its interactive Google-auth flow inside the machine-local authed Docker snapshot (`aigon-clean-room-authed:local`, contains real OAuth tokens, explicitly flagged in the spec as "audit, don't blind-edit") — not safely doable without rebuilding/re-authing that image interactively.
- ESCALATE:ambiguous — `lib/commands/misc.js`'s `detectAgents()` (rollout) has no directory-based heuristic for detecting `ag` specifically (its trust path is a home-dir path, and its skill output dir `.agents/skills/` is shared with `cx`/`op`). Left undetected rather than guess a heuristic; rollout will simply skip `ag` reinstalls until someone designs a reliable signal (e.g. consult `install-manifest.json` per-agent instead of directory probing).

### Notes
- Verified `templates/dashboard/js/budget-widget.js`'s remaining `gg` references (in `budgetAgentEnabled()` guards, static id arrays) are dead-but-harmless: `budgetAgentEnabled('gg')` reads `AIGON_AGENTS`, which is already launchable-only, so it's always `false`; the backend (`lib/budget-poller.js`) no longer ever writes a `gg` key. No functional impact — left as-is rather than risk an unverified multi-site dashboard edit.
- `lib/quota-poller.js` and `lib/agent-sessions/model.js`'s `PROVIDER_BY_AGENT_ID` still iterate/reference `gg` via `getAllAgents()` resp. a static map, but both resolve to safe no-ops (no CLI spawn for `gg`; the provider map is for historic-transcript inference, which should retain `gg: 'gemini'`) — confirmed correct as-is, not touched.
- Did not touch `package.json`'s `"gemini-cli"` npm keyword — that's public package metadata/discoverability, a maintainer call rather than a code-correctness fix.
- The implementer's core registry work (`lib/agent-registry.js`'s launchable/all-known split, `lib/budget-poller.js`'s SESSION_GG removal, the `entity-commands.js`/`feature-start.js`/`feature-draft.js`/`dashboard-settings.js` guard rails, and the test coverage in `agent-registry-contract.test.js` / `worktree-state-reconcile.test.js`) was solid and matched the spec precisely. The gaps found here were specifically in layered enumerators one level removed from `getAllAgentIds()` (exactly the class of miss the spec's own AC #2 warned about) and in maintainer-only tooling not covered by automated tests.
