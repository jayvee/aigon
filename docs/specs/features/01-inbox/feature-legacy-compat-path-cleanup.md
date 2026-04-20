# Feature: legacy-compat-path-cleanup

## Summary
Aigon's codebase carries meaningful compatibility and migration code that was defensible when added but is now dead weight: fallback handlers for features that pre-date workflow-core snapshots, migration helpers for agent-command layouts no active repo uses, tolerance for legacy folder names (`04-done`, `05-paused`) we only rediscovered by accident during the 2026-04-20 jvbot cleanup, a git-log spec-review scanner that the workflow engine is now meant to replace (post-F283), and various `compat` / `legacy` states in read models that aren't produced by any current write path.

Each was reasonable when introduced — they protected existing data through architectural transitions. But no current code path *produces* the shapes they handle, and leaving them in place costs three things:
1. **LOC** — ~500–800 lines across multiple files.
2. **Agent context cost** — every session reading `lib/workflow-read-model.js` or `lib/dashboard-status-collector.js` ingests these dead branches.
3. **Cognitive overhead** — maintainers have to prove "does this legacy path still matter?" every time they touch adjacent code.

Target: **~500–800 LOC removed** from `lib/workflow-read-model.js`, `lib/dashboard-status-collector.js`, `lib/templates.js`, `lib/workflow-core/paths.js`, and a handful of other surfaces. This feature is PURE DELETION — no behaviour change for any supported path.

## Desired Outcome
Every read path in the codebase is consumed by a write path that exists today. No defensive branches for shapes nothing produces. A reader of `lib/` sees a lean, current picture — not a palimpsest of 18 months of migrations. Grep for `legacy`, `compat`, `deprecated`, `migrate` and find only current, load-bearing code.

## User Stories
- [ ] As a maintainer editing `lib/workflow-read-model.js`, I don't reason about three legacy fallback states (`COMPAT_INBOX`, `LEGACY_MISSING_WORKFLOW`) that no code path reaches — they're gone.
- [ ] As an agent implementing a bug fix in the dashboard status collector, the ~100-line git-log spec-review scanner isn't there to read, understand, or accidentally break — engine events handle that now.
- [ ] As a reviewer auditing `lib/templates.js`, the migration helpers for old flat-command layouts are gone; only the current layout's code remains.
- [ ] As the grep reader, searching for `legacy` / `compat` / `deprecated` / `migrate` in `lib/` returns only current, load-bearing code — no "kept for safety" stumps.
- [ ] As a user of `aigon research-start <ID>`, the path resolver no longer tolerates legacy folder names like `04-done` that silently caused duplicate-match errors when research IDs were reused (jvbot 2026-04-20 bug class).

## Acceptance Criteria
- [ ] `lib/workflow-read-model.js`: `COMPAT_INBOX` and `LEGACY_MISSING_WORKFLOW` states + their creator functions + their `appendReadModelFlags` branches are deleted, OR the audit proves a specific write path still produces them (audit finding goes in the commit message as a deferral, and the code stays).
- [ ] `lib/dashboard-status-collector.js`:
  - Legacy status-file resolution (`legacyStatusFile` and the `actualStatusFile` fallback around line 762) is deleted if no current write path produces that file shape.
  - The spec-review git-log scanner (~100 lines, `applySpecReviewStatus` + its helpers `parseSpecReviewSubject`, `extractSpecReviewerId`, `readSpecReviewCommitBody`, `getSpecReviewEntries`, `parseSpecReviewNameStatusEntry`) is deleted IF F283's engine-backed rework already supersedes it. Otherwise the scanner deletion is deferred; the rest of this feature proceeds independently.
- [ ] `lib/templates.js`: `migrateOldFlatCommands`, `removeDeprecatedCommands`, `removeDeprecatedSkillDirs` are deleted if no current install-agent path exercises the shapes they migrate from. Otherwise document why they stay.
- [ ] `lib/workflow-core/paths.js`: `listVisibleSpecMatches` currently scans every numeric-prefixed folder via `/^\d+-/`. Tighten to an explicit allow-list (`01-inbox`, `02-backlog`, `03-in-progress`, `04-in-evaluation`, `05-done`, `06-paused` — derived from the canonical list in `lib/templates.js`). Prevents the jvbot-class bug structurally.
- [ ] `lib/dashboard-status-collector.js:817` (`listStageSpecFiles` for research) is tightened the same way — no legacy folder tolerance on read.
- [ ] Retired-agent references (e.g. `mv` / Mistral Vibe) are removed from any dead branches in switches, registry lookups, tests.
- [ ] All deletions are verified by: for each deleted branch, prove via `rg` that no current code path writes the shape it handled. Proof recorded in the commit message.
- [ ] Net LOC reduction across touched files is **at least 500 lines**, measured via `git diff --stat main..HEAD`.
- [ ] All existing tests pass. Tests that specifically asserted the deleted legacy behaviour are deleted in the same commit. Tests that incidentally used a legacy shape are updated.
- [ ] `docs/architecture.md` § State Architecture is updated to remove references to the deleted compat states. CLAUDE.md § Write-Path Contract incident list gets a new entry summarising which class of bug each removal prevents going forward.

## Validation
```bash
node -c lib/workflow-read-model.js
node -c lib/dashboard-status-collector.js
node -c lib/templates.js
node -c lib/workflow-core/paths.js
npm test
MOCK_DELAY=fast npm run test:ui
bash scripts/check-test-budget.sh
git diff --stat main..HEAD -- lib/ | tail -5   # verify ≥500 LOC reduction
```

## Technical Approach

### Audit first, delete second
For each candidate deletion: (a) identify the branch, (b) grep for producers of the shape it handles, (c) if zero producers, delete. PR splits into per-file commits so each deletion's proof is locally reviewable.

### Candidate inventory (audit confirms or defers each)

| File | Block | Reason it might be dead |
|------|-------|-------------------------|
| `lib/workflow-read-model.js` | `COMPAT_INBOX` state | All entities get bootstrapped snapshots via `ensureEntityBootstrapped`; no inbox entity should lack one. |
| `lib/workflow-read-model.js` | `LEGACY_MISSING_WORKFLOW` state | Fallback for numeric-ID entities without snapshot; bootstrap path produces one now (we proved this live on F285 today). |
| `lib/dashboard-status-collector.js` | `legacyStatusFile` fallback (~L762) | Old `feature-<id>-<agent>.json` naming was superseded; verify no writer still uses the short form. |
| `lib/dashboard-status-collector.js` | `applySpecReviewStatus` + git-log scanner | F283's engine-event rework should be authority. Verify snapshot-based pending-review state is live before deleting. |
| `lib/templates.js` | `migrateOldFlatCommands` | Migrated `.claude/commands/aigon-*.md` → `.claude/commands/aigon/*.md` (2025). No active repo should still have the old layout. |
| `lib/templates.js` | `removeDeprecatedCommands`, `removeDeprecatedSkillDirs` | Active churn if commands are still being renamed — check rename rate over last 3 months. |
| `lib/workflow-core/paths.js` | `listVisibleSpecMatches` permissive regex `/^\d+-/` | Replace with explicit canonical allow-list. Kills the jvbot-class bug for good. |
| `lib/dashboard-status-collector.js:817` | `listStageSpecFiles` research dir hardcoding | Same allow-list tightening for research stages. |
| `lib/agent-registry.js` | Retired-agent references | `mv` / Mistral Vibe was retired 2026-04-08; grep confirms dead. |
| `lib/commands/feature.js` + `lib/commands/research.js` | `compatibilityLabel` / `readOnly` branches | Consumed nowhere if COMPAT_INBOX / LEGACY_MISSING_WORKFLOW are deleted. |

### F283 coordination (the one real dependency)
F283 (`rethink-spec-review-workflow-state`) closed 2026-04-20. Before deleting the spec-review scanner, verify:
- `spec_review.submitted` / `spec_review.acked` events emitted by `afsr` / `afsrc`.
- `workflow-snapshot-adapter.js` surfaces pending-review state from the snapshot.
- Dashboard reads from the snapshot, not from `applySpecReviewStatus`.

If any are incomplete, scanner deletion defers to a follow-up; other deletions proceed independently.

### How to prove something is dead
For each candidate:
1. `rg 'EVENT_OR_TYPE_X'` — find producers.
2. If the only matches are in tests or the branch being deleted, it's dead.
3. If there's a real producer, note it; either update the producer or defer the deletion.
4. Record in the commit message.

### Order of operations
1. Audit pass — no code changes, just the inventory proving each candidate dead/alive.
2. Tighten `listVisibleSpecMatches` and `listStageSpecFiles` to explicit allow-lists. Low risk, immediate jvbot-bug-class prevention.
3. Delete `COMPAT_INBOX` + `LEGACY_MISSING_WORKFLOW` + their consumers.
4. Delete `legacyStatusFile` fallback.
5. Delete migration helpers in `templates.js`.
6. Delete spec-review git-log scanner (only if F283 path is verified operational).
7. Delete retired-agent references.
8. Final sweep: grep for `legacy`, `compat`, `deprecated`, `migrate` in `lib/` and close remaining stumps.

### Risk and mitigation
- **Delete something that IS still producing shape X for some user's state.** Mitigation: audit proves zero producers before deletion; "maybe" goes into deferred bucket.
- **A user on an older aigon version has state in deleted shape.** Mitigation: these paths have been the new-shape default since mid-2025; any 2026 aigon user has already migrated. CHANGELOG note covers the edge.
- **F283's engine-event rework isn't fully wired.** Mitigation: verify before deleting the scanner; defer if not.

## Dependencies
- **Soft dependency on F283** (`rethink-spec-review-workflow-state`) for deleting the git-log spec-review scanner. F283 is closed; audit at implementation time to confirm the engine-event path is the sole authority.
- No hard deps. Runs independently of F291, F288/F289/F290, and F292 (entity-command-unification filed alongside).

## Out of Scope
- Active, supported behaviour. Every deletion requires zero-producer proof.
- Consolidating XState machines or any architectural reshape — pure deletion only.
- Splitting `lib/commands/feature.js` or `lib/dashboard-server.js` by functional boundary — separate simplification feature.
- Entity unification (F292) — different files, different surface, orthogonal.
- Cleaning up `templates/` directory dead content — separate feature if desired.
- Removing commented-out code — handled by lint, not feature-worthy.

## Open Questions
- Is F283's engine-event path actually the sole spec-review authority now, or does the git-log scanner still co-authorize? (Lean: verify first, defer scanner deletion if not.)
- Do we tighten research `listStageSpecFiles` the same way as `listVisibleSpecMatches`? (Lean: yes, same class of bug.)
- Remove all retired-agent traces or keep graceful "unknown agent" errors? (Lean: remove entirely — clear error on reference, not silent degrade.)
- One big PR or sequential? (Lean: per-file commits on one branch, each with audit proof.)

## Related
- Triggered by: 2026-04-21 codebase audit for LOC-reduction candidates. Filed alongside F292 (`entity-command-unification`) — orthogonal file surface.
- 2026-04-20 jvbot legacy-folder bug: `listVisibleSpecMatches`'s permissive regex matched `04-done` as well as `05-done`, causing duplicate-matches when research IDs were reused. This feature closes that class structurally.
- F283 (`rethink-spec-review-workflow-state`) overlap on spec-review scanner — verify at implementation time; defer if not ready.
- CLAUDE.md § Write-Path Contract — deleting a read path is only safe when the corresponding write path is gone. This feature's audit protocol IS that check, applied systematically.
