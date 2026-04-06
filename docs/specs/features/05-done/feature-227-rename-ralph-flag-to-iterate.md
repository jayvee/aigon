# Feature: rename-ralph-flag-to-iterate

## Summary
Rename `feature-do --autonomous` / `--ralph` to `feature-do --iterate`. The old names collide with `feature-autonomous-start` in user-facing help and docs, making it impossible to tell the two autonomous modes apart from `aigon --help` alone. Zero behavior change — same retry loop, same iteration cap, same progress file — just a clearer flag name. Hard break on the legacy flags (they error with a one-line migration instruction). `--iterate` stays free, NOT Pro-gated (ergonomic CLI affordance, not unattended orchestration; see 2026-04-07 product discussion).

## Acceptance Criteria

- [ ] **AC1** — `lib/commands/feature.js:~L1060` accepts `--iterate` as the canonical flag. `--autonomous` and `--ralph` trigger a hard-error path: `❌ --autonomous/--ralph was renamed to --iterate on 2026-04-07.` + one-line `aigon feature-do <id> --iterate` instruction, `process.exitCode = 1`, return.
- [ ] **AC2** — `lib/templates.js:278` `feature-do` argHints: replace `[--autonomous]` with `[--iterate]`.
- [ ] **AC3** — Grep `lib/`, `templates/`, `docs/`, `CLAUDE.md`, `README.md` for `--autonomous`, `--ralph`, and user-facing "Ralph" mentions. Rewrite each to `--iterate` or "iterate loop". **Do NOT edit** `docs/specs/features/05-done/` or `docs/specs/features/logs/` — those are historical records. Internal names (`runRalphCommand` in `lib/validation.js`, `ralph-iteration.txt` template) can stay — they're never user-visible.
- [ ] **AC4** — `lib/config.js` — if `hasRalph` / `projectConfig?.ralph?.*` / `projectConfig?.autonomous?.*` readers exist for Ralph's config keys, keep them functional as silent fallbacks (existing user configs must keep working). Add `projectConfig?.iterate?.*` as the new canonical. No deprecation warnings on the old keys.
- [ ] **AC5** — `--iterate` behavior is identical to old `--autonomous`. Zero changes to `lib/validation.js:runRalphCommand` or the retry loop itself.
- [ ] **AC6** — `--iterate` is NOT Pro-gated. `assertProCapability` is not called on this path.
- [ ] **AC7** — Manual smoke: `aigon feature-do 1 --iterate` runs the loop normally; `aigon feature-do 1 --autonomous` errors with the migration hint and exits 1; `aigon feature-do 1` (no flag) still works interactively.
- [ ] **AC8** — Pre-push check passes: `npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh`.

## What is NOT changing

- `lib/validation.js:runRalphCommand` internals — the loop, iteration cap, validation command runner, progress file format
- `feature-autonomous-start` and AutoConductor — untouched
- `feature-do` without any flag — untouched
- Dashboard — zero surface area (Ralph/iterate is CLI-only)
- Workflow engine — untouched
- Pro gating surface — unchanged (still gates only `feature-autonomous-start`, `aigon insights`, and once shipped, `research-autopilot`)
- Historical spec logs in `05-done/` and `logs/` — grep will find matches but they stay as-is

## Related

- **2026-04-07 product discussion**: user picked Option A.3 (hard break rename) over C (delete). `--iterate` stays free because it's an ergonomic CLI affordance, not unattended orchestration.
- **Feature 222** (`pro-gate-research-autopilot`) — shrunk in the same commit to drop the Ralph gate; 222 no longer depends on this feature since they can ship in parallel
- CLAUDE.md rules T1 (pre-push tests) and T2 (new code ships with a test) — tests cover the deprecation error path
