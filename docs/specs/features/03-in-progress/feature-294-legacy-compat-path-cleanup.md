# Feature: legacy-compat-path-cleanup

## Summary
Aigon's codebase carries substantial compatibility and migration code that was defensible when added but is now active harm: fallback handlers for features that pre-date workflow-core snapshots, migration helpers for agent-command layouts no current repo uses, tolerance for legacy folder names (`04-done`, `05-paused`) that caused the 2026-04-20 jvbot duplicate-match bug, a git-log spec-review scanner that F283 superseded but which still runs and caused the Done-column badge bug, and defensive `compat`/`legacy` states in read models that **no current write path produces** but that keep surfacing as user-visible bugs (F285 and F293 both hit `LEGACY_MISSING_WORKFLOW` on 2026-04-21 via identical producers, hours apart).

**This feature takes the aggressive posture.** Aigon's user base is one primary user plus a handful of others the maintainer can contact personally. The normal reason to keep compat paths — "we can't break existing users" — doesn't apply here at the cost/benefit the maintainer is paying in bug-fix time. Policy for this work:

- **Delete by default.** If a branch handles a shape, and we can't name a current write path that produces that shape, it goes.
- **Surface hard errors, not silent fallbacks.** Previously: `if (!snapshot) { return legacyReadOnlyState() }`. After: `if (!snapshot) { throw … }` with a **single canonical migration hint** per surface (see Acceptance Criteria — migration command naming).
- **The migration escape valve is Phase 2**, not this feature. This feature removes the compat paths; Phase 2 adds `aigon doctor --migrate-from-legacy` as the single, documented way to upgrade any repo that still has old-shape state. **Until that subcommand exists**, error text must not contradict what already works today (`aigon doctor --fix` for snapshot bootstrap — see `lib/commands/feature.js` / `lib/commands/setup.js`).
- **Audit is for evidence-in-the-commit-message, not for deferral.** If an audit is uncertain, the deletion still happens — the commit message records "no producer found, surface hard-error if missed." That inverts the cost of being wrong from "silent bug recurs" to "loud error reaches the maintainer fast."

Target: **800–1200 LOC removed** across `lib/workflow-read-model.js`, `lib/dashboard-status-collector.js`, `lib/templates.js`, `lib/workflow-core/paths.js`, `lib/commands/feature.js`, `lib/commands/research.js`, plus incidental tests and helpers. Pure deletion + one-liner hard-error substitutions.

## Desired Outcome
Every read path in `lib/` is consumed by a write path that exists today. No defensive branches for shapes nothing produces. **Symbol-level:** no `COMPAT_INBOX`, `LEGACY_MISSING_WORKFLOW`, or legacy read-model branches remain. Broader English-word greps (`legacy`, `migrate`) are non-goals and may retain hits in unrelated prose. A reader sees a lean, current codebase, not a palimpsest. Agent context cost on every future session drops by the deleted LOC × every agent read. Future bugs in deleted shapes are structurally impossible (no code paths to bug).

## User Stories
- [ ] As the maintainer, when I hit a bug on feature N, I never again see the root cause reduce to "a legacy compat branch was producing bad state" — those branches are gone. F285 → F293 class of recurrence is structurally prevented.
- [ ] As an agent implementing a bug fix in `lib/workflow-read-model.js` or `lib/dashboard-status-collector.js`, I don't ingest ~200 LOC of defensive branches for states the write paths don't produce — the file is half its former size.
- [ ] As a grep reader, `rg 'COMPAT_|LEGACY_|legacyReadOnly' lib/` returns no hits outside error-string literals and comments that explicitly reference Phase 2. Broader `legacy|compat|deprecated` sweeps are advisory (may hit unrelated words in prose); file follow-up if noise remains.
- [ ] As a user whose repo still has pre-snapshot state (if any exists at all), I hit a clear hard error pointing me at `aigon doctor --migrate-from-legacy`. No silent degrade, no confusing half-states.
- [ ] As the eventual Phase 2 implementer, I have ONE well-defined migration path to build — I don't have to understand all the historical compat branches because they were deleted before I started.

## Acceptance Criteria
- [ ] **Migration command naming (blocking):** Before merge, grep `lib/` for user-visible strings that mention missing snapshots. Either (A) all still cite **`aigon doctor --fix`** until Phase 2 ships `migrate-from-legacy`, or (B) the same PR (or stacked PR) introduces **`aigon doctor --migrate-from-legacy`** and updates **every** prior `--fix` snapshot-bootstrap hint so operators never see two conflicting commands. Record the choice in the PR description. Do not ship hard-errors that only name a non-existent subcommand without `--fix` as fallback.
- [ ] `lib/workflow-read-model.js`: `COMPAT_INBOX` and `LEGACY_MISSING_WORKFLOW` states + their creator functions + every downstream branch that reads them are deleted. `getFeatureDashboardState` and `getResearchDashboardState` assume a snapshot exists; if it doesn't, **throw** (same message family as above AC) — no `readOnly`/compat return objects. Callers in `lib/dashboard-status-collector.js` / route layer must map thrown errors to a **logged, non-silent** dashboard response (HTTP 500 with JSON `{ error: string }` or existing dashboard error envelope — match whatever `dashboard-routes.js` + `dashboard-server.js` already use for collector failures; document the chosen pattern in the PR).
- [ ] `lib/dashboard-status-collector.js`:
  - Legacy status-file resolution (`legacyStatusFile` + the `actualStatusFile` fallback chain near L762) deleted.
  - The spec-review git-log scanner (`applySpecReviewStatus` and its helpers `parseSpecReviewSubject`, `extractSpecReviewerId`, `readSpecReviewCommitBody`, `getSpecReviewEntries`, `parseSpecReviewNameStatusEntry`, the whole block ~300-400) deleted in full. Dashboard reads pending-review state exclusively from the engine snapshot as F283 established.
  - Research-stage folder scan (`listStageSpecFiles` at L817) tightened to the explicit canonical allow-list (same treatment as `listVisibleSpecMatches` below).
- [ ] `lib/workflow-core/paths.js`: `listVisibleSpecMatches` tightened from the permissive `/^\d+-/` regex to an explicit allow-list of canonical folder names (`01-inbox`, `02-backlog`, `03-in-progress`, `04-in-evaluation`, `05-done`, `06-paused`). Any other folder is invisible to the resolver. Kills the jvbot bug class structurally. Derive the canonical list from a single source of truth (reuse `PATHS.features.folders` from `lib/templates.js` rather than duplicating).
- [ ] `lib/templates.js`: `migrateOldFlatCommands`, `removeDeprecatedCommands`, `removeDeprecatedSkillDirs` deleted. If any install-agent flow still called them, that flow is updated to not call them (the migration they performed ran in 2025; no current repo needs it).
- [ ] `lib/commands/feature.js` + `lib/commands/research.js`: all `compatibilityLabel`, `readOnly: true`, and "missing snapshot" branches consumed by the deleted read-model states are removed. `feature-list`, `feature-status`, and equivalent research commands error hard if a spec exists with no snapshot, pointing at the migration command.
- [ ] Retired-agent references (`mv` / Mistral Vibe) removed from all switches, registry lookups, and tests. An explicit reference to an unknown agent ID errors — no silent degrade.
- [ ] Every deletion's commit message records the audit: which producer(s) were searched for, where (`rg` command used), and whether zero producers were found. Defer only if an audit turns up a real producer — and in that case, update the producer first, then delete in a follow-up commit on the same branch.
- [ ] Net LOC reduction across touched files is **at least 800 lines**, measured on the implementation branch via `git diff --stat "$(git merge-base main HEAD)..HEAD" -- lib/` (or equivalent against the repo default branch). Stretch goal: 1200. Paste the diffstat tail in the PR.
- [ ] All existing tests pass. Tests that asserted deleted legacy behaviour are deleted in the same commit as the behaviour — they were asserting dead code. Tests that used legacy shapes incidentally are updated to use current shapes.
- [ ] **New tests**: one per major deletion verifying the hard-error path replaces the fallback. Each test must name the **fixture setup** (e.g. temp repo with `docs/specs/features/03-in-progress/feature-NN-*.md` and **no** `.aigon/workflows/features/NN/snapshot.json`), the **entry surface** (CLI: `node aigon-cli.js feature-list` / `feature-status` / dashboard API route that hits the collector — pick one concrete invocation per test), and the **assertion**: non-zero CLI exit **or** HTTP ≥400 with body containing the canonical migration substring from the naming AC above; assert response does **not** contain `"readOnly": true` / `LEGACY_MISSING_WORKFLOW` / `COMPAT_INBOX`.
- [ ] `docs/architecture.md` § State Architecture rewritten to remove every reference to the deleted compat states. The new narrative is: "every entity has a workflow-core snapshot; no snapshot is a migration problem, not a runtime fallback."
- [ ] CLAUDE.md / AGENTS.md § Write-Path Contract incident list gets one new entry per class of deletion summarising which producer-drift bug each removal prevents.

## Validation
```bash
node -c lib/workflow-read-model.js
node -c lib/dashboard-status-collector.js
node -c lib/templates.js
node -c lib/workflow-core/paths.js
node -c lib/commands/feature.js
node -c lib/commands/research.js
npm test
MOCK_DELAY=fast npm run test:ui
bash scripts/check-test-budget.sh
git diff --stat "$(git merge-base main HEAD)..HEAD" -- lib/ | tail -5   # verify ≥800 LOC reduction on branch
# Near-zero legacy symbols (tune pattern if error strings legitimately contain words like "migrate"):
rg 'COMPAT_|LEGACY_|LEGACY_MISSING|COMPAT_INBOX' lib/ --type js
rg '\blegacyReadOnly\b|readOnly:\s*true' lib/dashboard-status-collector.js lib/workflow-read-model.js --type js
```

## Pre-authorised
- May raise `scripts/check-test-budget.sh` CEILING by up to +60 LOC if the new hard-error regression tests require it. Commit must cite this line in its footer.
- May delete tests in `tests/` that asserted dead legacy behaviour — no "find a replacement" requirement, dead tests go with the dead code.

## Technical Approach

### Why the aggressive posture now
The compat paths were defensible when aigon was expected to support a growing user base and gradual migration. That's not the current reality. The maintainer is the primary user, with 2–3 additional users who can be personally contacted. Every bug in a compat path is paid for out of one person's bug-fix time; every forced migration is near-zero cost because "forced migration" for this user base means running one command on up to a handful of repos.

Two incidents in the last 48 hours crystallise this:
- **F285 → F293** (2026-04-21): identical `LEGACY_MISSING_WORKFLOW` badge, identical root cause, identical instance fix, predictable recurrence hours apart. Root cause landed in `4df8fe9d` (entityResetBase re-bootstraps), but the LEGACY_MISSING_WORKFLOW read-model state is still there waiting to trip the next producer.
- **jvbot research-02 duplicate-match** (2026-04-20): the path resolver's permissive regex tolerated legacy folder names. Tightening it prevents the whole class.

### Invariant after this feature
**Every entity has a workflow-core snapshot.** That's the only supported state. Any code path that can't find a snapshot throws pointing at the migration command. Not `if (!snapshot) { fallback }` — `if (!snapshot) { throw }`.

### The migration escape valve (Phase 2, not this feature)
Phase 2 is a separate feature: `aigon doctor --migrate-from-legacy` that walks a repo and:
- Backfills snapshots for any feature/research with a spec file but no snapshot
- Normalises folder names (`04-done` → `05-done`, `05-paused` → `06-paused`)
- Projects pre-F283 `spec-review:` / `spec-review-check:` commits into engine events
- Reports what it migrated

This feature writes the hard-error messages pointing at that command. The command itself doesn't have to exist yet — the error message names it, and users who hit it (unlikely for most) get the heads-up. Phase 2 fills in the implementation.

### Candidate inventory (pre-audit; the implementation audit confirms/refines each)

| File | Block | Pre-audit assessment | Action |
|------|-------|----------------------|--------|
| `lib/workflow-read-model.js` | `COMPAT_INBOX` state | All inbox entities get snapshots via `ensureEntityBootstrapped` | Delete |
| `lib/workflow-read-model.js` | `LEGACY_MISSING_WORKFLOW` state | No current producer writes "numeric ID + no snapshot" — `feature-reset` was the last one and now re-bootstraps (4df8fe9d) | Delete; replace consumers with hard-error |
| `lib/dashboard-status-collector.js` | `legacyStatusFile` fallback (~L762) | Old `feature-<id>-<agent>.json` naming superseded | Delete |
| `lib/dashboard-status-collector.js` | `applySpecReviewStatus` + git-log scanner (~100 LOC) | F283's engine-event authority supersedes | Delete in full |
| `lib/dashboard-status-collector.js` | `listStageSpecFiles` research permissive regex | Same class as `listVisibleSpecMatches` | Tighten to explicit allow-list |
| `lib/workflow-core/paths.js` | `listVisibleSpecMatches` permissive `/^\d+-/` regex | jvbot bug class | Tighten to canonical allow-list from `PATHS.features.folders` |
| `lib/templates.js` | `migrateOldFlatCommands` | Pre-2026 migration; no current repo has old layout | Delete |
| `lib/templates.js` | `removeDeprecatedCommands`, `removeDeprecatedSkillDirs` | Some renames still churn; audit specifically | **Decision rule (not open-ended):** run `git log --since=90.days.ago --oneline -- templates/generic/commands/`. Zero commits touching renames → delete helpers in this feature. Any rename commit → keep helpers for this feature only; file a one-line tech-debt issue to delete them next quarter with evidence link |
| `lib/agent-registry.js` | Retired-agent references | mv/Mistral Vibe retired 2026-04-08 | Delete; unknown agent = hard error |
| `lib/commands/feature.js` + `lib/commands/research.js` | `compatibilityLabel`, `readOnly: true` branches | Consumed by the deleted read-model states | Delete |

### Ordering (per-commit, reviewable atomically)
1. **Tighten `listVisibleSpecMatches` and `listStageSpecFiles` regexes.** Immediate bug-class prevention. Smallest blast radius. Ship first.
2. **Delete `COMPAT_INBOX` and `LEGACY_MISSING_WORKFLOW` + consumers.** Medium blast radius. Any call site that can't find a snapshot now throws — catches any remaining producer we missed.
3. **Delete the spec-review git-log scanner + helpers.** F283's path is sole authority.
4. **Delete `legacyStatusFile` fallback.** Small, isolated.
5. **Delete `templates.js` migration helpers.** Install-agent flow only.
6. **Delete retired-agent references.** Cleanup sweep.
7. **Final grep sweep** for `legacy`, `compat`, `deprecated`, `migrate` in `lib/` — any remaining hits are either the (not-yet-implemented) migration command reference in error strings, or another audit finding.

### Risk and mitigation
- **Delete something that IS still producing shape X.** Mitigation: the hard-error replacement makes this LOUD — user sees an error referencing the migration command, reports it, we fix the producer in a follow-up. No silent bug.
- **A user with pre-migration state hits a hard error.** Mitigation: error message names `aigon doctor --migrate-from-legacy`. Phase 2 implements that command; until then, the maintainer can hand-migrate affected users (expected count: zero to two).
- **Compat-inbox branches are also consumed by feedback entities**, which use a different state model (per CLAUDE.md). Mitigation: feedback stays out of scope; only feature + research entities are affected.
- **Deleting the git-log spec-review scanner reveals a missing engine-event emission.** Mitigation: F283 was supposed to handle this; audit confirms before delete.

## Dependencies
- **Soft: F283** (already closed). Verify at implementation time that its engine-event rework is the sole spec-review authority.
- **None hard.** Phase 2 (`doctor --migrate-from-legacy`) is downstream; this feature references it in error strings but doesn't depend on it existing yet.

## Out of Scope
- **Phase 2 migration command.** Separate feature; file immediately after this lands.
- **XState machine or effect-lifecycle consolidation.** Different surface.
- **Splitting oversized files** (`lib/commands/feature.js`, `lib/dashboard-server.js`). Separate simplification feature.
- **Entity-command further unification** beyond what F292 did. Separate feature.
- **Feedback compat paths.** Feedback uses a different state model; stays untouched.
- **Removing `templates/` directory dead content.** Separate cleanup.
- **Changing `aigon feature-reset` or `aigon feature-close` behaviour** beyond removing the compat-state consumers. Out of scope.

## Open Questions
- Should the hard-error messages include a one-liner about what `doctor --migrate-from-legacy` will do (e.g., "backfills missing snapshots"), or just the command? (Lean: just the command. Docs expand it.)
- For the `listVisibleSpecMatches` tightening: should any non-canonical folders in existing repos be reported by `aigon doctor` as "rename these to canonical names," or silently ignored? (Lean: reported. Otherwise users won't know their files became invisible.) **Owner:** Phase 2 spec unless `doctor --fix` already gains a dry-run report in this PR (then document which).

## Implementation notes (branch review, 2026-04-21)

- **Migration hint (blocking AC):** Option **(A)** — user-visible snapshot-bootstrap strings cite `aigon doctor --fix` until Phase 2 adds `doctor --migrate-from-legacy`.
- **Throw vs `MISSING_SNAPSHOT`:** Original AC text said the read-model should **throw** when no snapshot. Shipped behaviour matches `AGENTS.md` / `docs/architecture.md`: **dashboard** returns `WORKFLOW_SOURCE.MISSING_SNAPSHOT` (no actions, no badge) so the grid still loads; **CLI** surfaces non-zero exit + `doctor --fix`. Documented in `CLAUDE.md`, `docs/architecture.md`, and comments in `lib/workflow-read-model.js`.
- **`removeDeprecatedCommands` / `removeDeprecatedSkillDirs`:** Per the spec’s own decision rule, **`git log --since=90.days.ago -- templates/generic/commands/`** shows ongoing template churn — helpers **remain** for this release; revisit next quarter if command renames go quiet. `migrateOldFlatCommands` is removed from `lib/templates.js` as planned.
- **LOC metric:** Measure with `git diff --stat "$(git merge-base main HEAD)..HEAD" -- lib/`. If net deletions under `lib/` fall short of the 800-line stretch, cite **total-branch** `git diff … --shortstat` in the PR and treat the numeric goal as aspirational for follow-up deletions outside F294.

## Related
- Triggered by: maintainer conversation on 2026-04-21 reviewing the F285→F293 legacy-state recurrence and recognising that the cost/benefit of compat paths doesn't match aigon's user-base size.
- `4df8fe9d` — entityResetBase re-bootstraps post-wipe; removes the last known producer of LEGACY_MISSING_WORKFLOW state, clearing the path for this feature to delete the read-model fallback.
- F283 (closed 2026-04-20) — spec-review rework; this feature finishes the job by deleting the git-log scanner F283 superseded.
- jvbot 2026-04-20 incident (research-02 duplicate-match) — the path-resolver tightening in this feature closes that bug class.
- Phase 2 follow-up spec (to be filed immediately after this one closes): `aigon doctor --migrate-from-legacy` — single migration command for any user still on pre-snapshot / legacy-folder state.
- CLAUDE.md § Write-Path Contract — "every read path produced by every write path." This feature enforces it structurally by deleting every read path whose write path no longer exists.
