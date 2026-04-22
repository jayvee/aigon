# Feature: prune-test-suite-bloat

## Summary

Delete incident-era regression tests whose producers are cold, collapse duplicate coverage, extract shared fixtures into `tests/_helpers.js`, and change `scripts/check-test-budget.sh` so the ceiling can't be raised silently again. Target: land the suite at or under the existing 2500 LOC ceiling (currently 2848, over by 348).

## Context / Why

The integration suite is **bloating on a ratchet**. Twice before it was cut back from 14,000+ LOC after similar drift; a hard numeric ceiling was installed to prevent a third round. But the ceiling only bites on *new* tests — it doesn't retire cold ones, and the ratchet continues because:

- **26 of 29 integration test files** begin with a `REGRESSION:` comment naming a specific incident. Each incident leaves a permanent file.
- Commit `ac0a657e test(f294): raise test budget ceiling to 2360 LOC` shows the default reach: raise the ceiling rather than prune.
- Tests are being minified (`feature-close-restart.test.js`, `stats-aggregate.test.js`) into unreadable one-liners just to fit budget — a smell that value-per-LOC has already collapsed for those tests.
- Multiple files overlap: bootstrap / read-model / review-status coverage is smeared across 4+ files with near-duplicate setup.

## User Stories

- [ ] As a contributor, after this feature lands, `bash scripts/check-test-budget.sh` passes with room to spare (≤ 2500 LOC).
- [ ] As a contributor adding a bug fix, when I go to add a regression test, the budget script **tells me to consider whether the producer API can be hardened instead** — and refuses a ceiling raise unless I delete another test in the same commit.
- [ ] As a reviewer, I can find all review-status coverage in one file instead of four.

## Acceptance Criteria

### Concrete deletions / collapses

Target suite LOC ≤ 2500 after the following (numbers in parens are the estimate from analysis; exact LOC may differ slightly):

- [ ] `tests/integration/f294-legacy-cleanup.test.js` — **delete entirely** (−74 LOC). Every assertion guards against re-introducing code that was removed; no live producer. PR review catches any re-introduction.
- [ ] `tests/integration/bootstrap-engine-state.test.js` — shrink from 192 → ~90 LOC (−100). Keep only the rollback-on-failure test (live behavior). Drop:
  - `entityCreate stores authorAgentId` (duplicated by `dashboard-review-statuses.test.js::collectRepoStatus includes authorAgentId…`)
  - `entityPrioritise migrates slug-keyed workflow state` + `bootstrapMissingWorkflowSnapshots migrates slug-keyed inbox specs` (same one-time migration from two angles; cold)
  - `workflow read model exposes prioritise for slug-backed inbox snapshots` (overlaps `workflow-read-model.test.js`)
  - `findEntitiesMissingWorkflowState discovers snapshotless research inbox specs` (overlaps F294 cleanup)
- [ ] `tests/integration/misc-command-wrapper.test.js` — shrink from 112 → ~75 LOC (−37). Drop:
  - `legacy iterate flags still hard-error` — deprecation guard for long-dead flags.
  - `repair registration and worktree/reset guard rails stay wired` — regex-greps across 4 files; tests file contents, not behavior.
  - `Autopilot buildIterationCarryForward` — string-truncation unit test belongs with the function or not at all.
  - Keep: nudge tests (behavioural) and `getFeatureSubmissionEvidence` tests (live code path).
- [ ] `tests/integration/workflow-read-model.test.js` — collapse `autonomous plan exposes future reviewed solo stages` + `autonomous plan fails loudly when workflow metadata cannot be resolved` into one table-driven test (−~30 LOC).
- [ ] `tests/integration/agent-prompt-resolver.test.js` — collapse three template-substring tests into one table-driven test; delete `review-check injection gate: capability true→slash, missing→fail-closed` (the `for`-loop above already covers every agent's capability path). (−~30 LOC)

### Fixture extraction

- [ ] Move shared helpers into `tests/_helpers.js` (or a new `tests/fixtures.js`):
  - `seedEntityDirs(repo, kind)` — currently appears in 4+ files with minor variations
  - `writeSpec(repo, kind, stage, file)`
  - `writeSnap(repo, kind, id, lifecycle)`
  - `withRepoCwd(repo, fn)` from `bootstrap-engine-state.test.js`
- [ ] Update `lifecycle.test.js`, `workflow-read-model.test.js`, `dashboard-review-statuses.test.js`, `bootstrap-engine-state.test.js` (what's left), and any others to import the shared helpers.
- [ ] Net effect should be a further ~60 LOC reduction across consumers, more than offsetting the ~30 LOC added to `_helpers.js`.

### Test-budget script policy change

- [ ] `scripts/check-test-budget.sh`: if a commit bumps the `CEILING=` default, the same commit must also delete at least one `tests/**/*.test.js` file. Enforce via a pre-commit check or an inline sanity check in the script itself that compares the committed diff. Exit 1 with a clear message: `Ceiling raise requires same-commit deletion of at least one test file. Consider hardening the producer instead.`
- [ ] Update the failure message to also recommend: *"Consider whether the producer API can be hardened (stricter types/enums, removed dead branch) rather than adding a regression test."*
- [ ] Current ceiling stays at 2500. No raise.

### Agent review instructions

- [ ] `templates/generic/commands/feature-code-review.md` (and/or the agent-specific variants): add a short guideline that when proposing fixes, **do not add a regression test by default**. Prefer: (a) fix the producer's API/types to prevent re-introduction, (b) add a test only if the bug is subtle enough that PR review won't catch it.

### Verification

- [ ] `npm test` passes.
- [ ] `bash scripts/check-test-budget.sh` exits 0 (suite ≤ 2500 LOC).
- [ ] No reduction in coverage for the following live code paths: feature-close merge+stash, feature-close scan target, lifecycle (start → ready → close, fleet, pause/resume), workflow read-model snapshot-vs-folder drift, nudge delivery, global-config migration.

## Validation

```bash
npm test
bash scripts/check-test-budget.sh
```

## Pre-authorised

- May delete entire files under `tests/integration/` without explicit confirmation — this feature IS the deletion.
- May rewrite retained tests to use shared fixtures (signature changes OK as long as test bodies stay readable).
- May NOT raise the LOC ceiling. If the concrete deletions listed above don't land the suite ≤ 2500, stop and ask before raising.

## Technical Approach

### Ordering (one commit per logical step so review can follow)

1. **Fixture extraction** first. Add helpers to `tests/_helpers.js`, update consumers. This is the lowest-risk change and unlocks LOC math for later deletions.
2. **Deletions and collapses** second, one commit per file in the list above. Each commit re-runs `npm test` and `check-test-budget.sh`.
3. **Budget-script policy change** last. Isolate the policy change from the data change so reviewers can reason about them independently.

### What to preserve

These regression tests **must survive** — their incidents are recent or their producers are still evolving:

- `feature-close-scan-target` — guards the F245 incident; producer still evolving.
- `feature-close-restart` — F228/F234 restart-marker contract; live code.
- `rebase-needed.test.js` — F300, recent.
- `global-config-migration.test.js` — F309 shipped last week; stay conservative.
- `spec-review-status.test.js` — spec-review workflow still maturing.
- `awaiting-input*.test.js` — F285, tight coverage of the pulsing-badge state.

### Retirement policy (for future incidents)

- Agent review instructions updated as listed above.
- Monthly manual prune is out of scope for this feature (would be a separate automation). Document as an Open Question.

## Dependencies

- None. Self-contained. Can land on top of the current `main` whenever.
- Should NOT be bundled with the in-flight feature-close stash-pop fix (commit `c7882a9a`) or any open review work — the deletions will interleave confusingly.

## Out of Scope

- Rewriting dashboard-e2e (`tests/dashboard-e2e/`) specs — separate concern, smaller file count, not in the LOC-bloat critical path.
- Adding a quarterly automated retirement job — belongs in its own spec once this one lands.
- Migrating to a different test framework (Vitest, etc.) — out of scope; this is about content, not tooling.

## Open Questions

- Should the `_helpers.js` signature keep the existing minimal surface (`withTempDir`, `test`, `report`) or grow with these new fixtures? Leaning: grow it — it's already the single shared helper module.
- Does the budget-script policy check work cleanly under `git bisect`? The "last commit that raised CEILING=" logic may need a guard for the common case of the ceiling never having been touched.
- Should we automate a **90-day retirement flag** for `REGRESSION F<nnn>` tests whose feature spec is in `05-done/` for > 90 days? Could be implemented as a new `scripts/check-test-budget.sh` warning (non-blocking). Leaning: defer to a follow-up feature.

## Related

- `scripts/check-test-budget.sh` — ceiling script. Owns the policy change.
- `tests/_helpers.js` — fixture extraction target.
- Commit `ac0a657e test(f294): raise test budget ceiling to 2360 LOC` — the most recent ratchet event; model for what this feature prevents.
- Conversation 2026-04-22: deep review of the test suite that generated this list.
