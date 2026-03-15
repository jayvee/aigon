---
status: submitted
updated: 2026-03-15T22:41:43.843Z
startedAt: 2026-03-05T01:32:53+11:00
completedAt: 2026-03-05T01:41:57+11:00
autonomyRatio: 1.00
---

# Implementation Log: Feature 37 - modes-and-terminology

## Plan

Phase 1: Rename all user-facing CLI output in `aigon-cli.js` to use new mode names (Drive, Fleet, Autopilot, Swarm). Keep internal function names and state filenames unchanged.

## Progress

- Added `normalizeMode()` helper for legacy alias resolution
- Added `resolveConfigKeyAlias()` for config key backwards compat (`fleet.*` → `arena.*`)
- Added `--autonomous` flag with `--ralph` as hidden alias
- Renamed mode values: `solo` → `drive`, `arena` → `fleet`, `solo-wt` → `drive-wt`
- Renamed `isArenaMode` → `isFleetMode` (13 references)
- Updated ~50+ user-facing console output strings
- Updated board indicators: `[F:N]` for Fleet, `[AP]` for Autopilot
- Updated help text with Modes summary block
- Config keys `fleet.*` and `autonomous.*` resolve to legacy `arena.*` and `ralph.*`
- Preserved internal function names (`runRalphCommand`, etc.) and state filenames (`ralph-progress.md`)

## Decisions

- Internal function names deferred to Phase 2 / file-split feature
- State filenames (`ralph-progress.md`) unchanged to avoid migration
- Warp config names (`arena-feature-*`) unchanged to avoid breaking existing configs
- Config keys use alias resolution rather than renaming stored keys
