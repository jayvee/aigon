---
complexity: high
recommended_models:
  cc: { model: claude-opus-4-7, effort: high }
  cx: { model: gpt-5.4, effort: high }
  gg: { model: gemini-3.1-pro-preview, effort: high }
  cu: { model: null, effort: null }
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-21T06:20:59.506Z", actor: "cli/feature-prioritise" }
---

# Feature: bootstrap-engine-state-on-create

## Summary
`aigon feature-create` (and `research-create`) write a spec file to `01-inbox/` but never seed the workflow-core engine. Inbox entities therefore exist with a **slug** as identifier and **no snapshot**. Every read path that reaches them has to handle the "spec-without-snapshot" case — and F294's deletion of `COMPAT_INBOX` is the incident that proved the invariant we want is hard to hold: when one read path deletes its compat branch, every producer of snapshotless state becomes a silent bug.

This feature closes the invariant: **every entity has a workflow-core snapshot from the moment its spec file is created through the CLI**. `feature-create` and `research-create` bootstrap workflow state at `inbox` lifecycle as part of the same write path that creates the spec. Inbox entities use the slug as the engine entity-id. `feature-prioritise` then re-keys the workflow state from slug → numeric id via one shared write-path helper used by both features and research.

After this feature:
- No "missing snapshot" read-model fallback is needed. `buildMissingSnapshotState` can return truly empty (no actions) because it only fires for *actually broken* state — no longer for the normal "just-created inbox" case.
- `feature-reset`'s re-bootstrap call (`4df8fe9d`) becomes one of several producers, not the only survivor.
- F294's `COMPAT_INBOX` deletion is retroactively correct — no live producer of snapshotless-inbox state remains.
- The b1db12d3 narrow fix (stage-derived actions on missing snapshots) becomes a belt-and-braces fallback; it's rarely hit in practice because inbox entries now have proper snapshots.

## Desired Outcome
The Write-Path Contract invariant — "every entity has an engine snapshot" — is structurally true, not approximately true. A maintainer can delete compat read paths with confidence because the only remaining producers of snapshotless state are out-of-band mutations: hand-edited specs, partially upgraded repos that have not run `aigon doctor --fix`, or filesystem damage. Those stay explicit migration / repair cases rather than normal dashboard behaviour.

## User Stories
- [ ] As a maintainer, when I delete a compat read path, I'm not retroactively breaking live producers — because `feature-create` + `research-create` + `feature-reset` all produce proper snapshots.
- [ ] As the dashboard, when I render an inbox card, I read from the snapshot like I do for every other stage — no `buildMissingSnapshotState` fallback.
- [ ] As a read-side consumer (`resolveFeatureSpec`, dashboard collector, board), a slug-keyed inbox entity resolves cleanly from its snapshot-backed state without needing a missing-snapshot compat branch.
- [ ] As the operator after `aigon feature-prioritise`, the ID transitions from slug → numeric atomically. Engine state moves with the folder. No new "half-migrated" states possible.
- [ ] As a future feature writer, if my read path assumes a snapshot exists, that assumption is safe.

## Acceptance Criteria
- [ ] `entityCreate` in `lib/entity.js` is changed so spec creation and bootstrap are one logical write path. If `ensureEntityBootstrapped(repoPath, entityType, slug, 'inbox')` fails, the command exits non-zero and removes the just-written spec file instead of leaving a snapshotless inbox entity behind.
- [ ] The create path does not print success or open the editor until both writes succeed. If needed, extend `createSpecFile()` or add a shared wrapper rather than bolting bootstrap on after the fact.
- [ ] Engine state for inbox entities lives at `.aigon/workflows/{features,research}/<slug>/` — slug as directory name. Directory names with non-numeric characters are safe (the path resolver already tolerates them; verify no assumption breaks).
- [ ] `entityPrioritise` in `lib/entity.js` (shared factory) re-keys workflow state from slug-keyed → numeric-keyed via one shared helper. The helper owns event rewrite, snapshot rewrite, and `specPath` rewrite for both features and research; callers do not duplicate this logic.
- [ ] Re-keying is crash-safe: after any failure, the repo is left in one of two auditable states only: old slug-keyed workflow state still intact, or new numeric-keyed workflow state fully present. No half-visible directory / file mix.
- [ ] `listVisibleSpecMatches` and related path resolvers tolerate slug-keyed engine state directories alongside numeric-keyed. Test: inbox entity with slug, backlog entity with numeric — both visible, no collision.
- [ ] `workflow-read-model.js` `buildMissingSnapshotState` is simplified only after the explicit migration path covers pre-existing inbox slug specs. Missing snapshots then mean genuinely broken / unmigrated state, not a normal inbox path.
- [ ] `feature-reset` / `research-reset` semantics do not change. Resets still move prioritised entities back to `02-backlog/` under their numeric id and re-bootstrap numeric workflow state there; this feature is about create-time inbox bootstrap, not a new reset-to-slug mode.
- [ ] Dashboard reads inbox actions from the snapshot like every other stage — no code path checks for "null snapshot" as a normal case.
- [ ] Explicit migration exists for existing repos with pre-feature inbox specs: `aigon doctor --fix` (and any bootstrap-on-init path) discovers slug-keyed inbox specs and creates `inbox` snapshots for them. Dashboard/server read paths remain detect-only and do not mutate engine state.
- [ ] Regression tests:
  - `feature-create foo` creates both the spec file AND the snapshot; removing either leaves a broken state with a clear error.
  - `feature-prioritise foo` migrates slug-keyed → numeric-keyed; post-prioritise, slug directory is gone, numeric directory exists with rewritten event/snapshot identity and updated `specPath`.
  - `aigon doctor --fix` migrates a pre-existing `01-inbox/feature-foo.md` with no snapshot into a slug-keyed inbox snapshot. No dashboard read is required to trigger the migration.
  - Dashboard renders an inbox card with a slug-backed snapshot and shows `feature-prioritise` from snapshot-backed actions, not from the missing-snapshot fallback.
- [ ] `docs/architecture.md` § State Architecture updated: the invariant is now "every entity has a snapshot from creation onward." Remove the "slug entities are special" carve-outs.
- [ ] CLAUDE.md / AGENTS.md § Write-Path Contract gains an entry: F294/b1db12d3 as the incident that motivated closing this invariant.

## Validation
```bash
node -c lib/entity.js
node -c lib/commands/entity-commands.js
node -c lib/workflow-core/engine.js
node -c lib/workflow-read-model.js
npm test
MOCK_DELAY=fast npm run test:ui
bash scripts/check-test-budget.sh
```

## Pre-authorised
- May raise `scripts/check-test-budget.sh` CEILING by up to +50 LOC if the bootstrap / re-key regression tests require it. Commit must cite this line in its footer.
- May delete the narrow fix from b1db12d3 (`buildMissingSnapshotState` stage-action derivation) once the inbox-with-snapshot invariant is live.

## Technical Approach

### Why this wasn't done originally
Feature IDs have always been assigned at prioritise time, not create time. Inbox slugs were historically "just filenames" — not first-class entity identifiers. The workflow engine was introduced later and inherited that model; inbox entities were allowed to lack snapshots because the compat read paths (`COMPAT_INBOX`) covered them.

F294 deleted `COMPAT_INBOX` on the correct principle ("every entity has a snapshot") but didn't change the producers that violated the principle. This feature makes the producers match the principle.

### Slug as engine identifier — precedent and concerns
The path layer already tolerates non-numeric entity IDs, and the dashboard / board read paths already accept slug identifiers when a spec has no numeric id yet. The concerns are:

1. **Path resolver collisions.** `listVisibleSpecMatches` currently scans canonical stage folders for `feature-<id>-<desc>.md`. A slug-keyed entity's spec doesn't have a numeric id prefix, so it matches the "name-only" branch (already in use for backlog/inbox slug entities). Verify the branch correctly handles "slug has snapshot" without regressing.
2. **Snapshot filename.** `.aigon/workflows/features/<slug>/snapshot.json` — slug contains hyphens, safe for directory names. No other gotchas expected.
3. **Create-path sequencing.** `createSpecFile()` currently writes the file, prints success, and opens the editor immediately. Bootstrapping cannot be bolted on after that without recreating the same half-state on failure. The helper boundary must change so success is reported only after both writes succeed.
4. **ID uniqueness.** Slugs are unique per-repo (enforced by `aigon feature-create` rejecting existing slugs). Good enough.

### Prioritise as re-keying
Current `entityPrioritise` already migrates workflow identity for slug-keyed inbox items via `migrateWorkflowEntityId()`. This feature should harden that path rather than invent a second mechanism:
- Move the helper behind a clearer shared boundary (prefer workflow-core ownership, or at minimum one shared helper in `lib/entity.js` used by both entities).
- Hold the workflow lock while rewriting event ids, snapshot ids, and `specPath`.
- Treat a missing slug workflow directory during prioritise as a producer bug and fail loudly with a repair hint; do not silently prioritise into a new numeric snapshot and leave the old slug state orphaned.

### Migration path for existing repos
Any current repo has a pile of pre-existing inbox spec files with no snapshots (this was the normal state until now). Migration must stay on explicit write paths, not read paths:
- Extend `findEntitiesMissingWorkflowState()` / `bootstrapMissingWorkflowSnapshots()` so they also discover inbox slug specs (`feature-foo.md`, `research-bar.md`) and bootstrap them at `inbox`.
- Run that explicit migration from `aigon doctor --fix` and any other existing bootstrap path that already seeds workflow state (`aigon init` for seed repos, if appropriate).
- Keep dashboard/server reads detect-only. If a repo has not been migrated yet, reads surface `MISSING_SNAPSHOT` and point at `aigon doctor --fix`; they do not repair it implicitly.

### Belt-and-braces fallback
Keep `buildMissingSnapshotState` as a null-return for genuinely-broken rows (e.g., someone `rm -rf`'d the `.aigon/workflows/` directory, or a repo has not run explicit migration yet). Remove the stage-action derivation added in b1db12d3 only after `feature-create`/`research-create` bootstrap inbox state and `aigon doctor --fix` covers pre-existing inbox slug specs.

### Interaction with F294
F294's core principle ("every entity has a snapshot") becomes retroactively correct once this feature lands. F294's audit was right about the destination; this feature builds the producer discipline that makes it safe.

### Risk
- **Re-keying atomicity.** If prioritise fails mid-way, you get a half-migrated state. Mitigation: one shared helper owns the move under lock and guarantees either "old slug state remains" or "new numeric state is complete". No best-effort ad hoc rewrites at each call site.
- **Create-path half success.** `createSpecFile()` currently reports success before bootstrap exists. Mitigation: restructure the helper boundary so editor-open / success-print happen after both writes, and rollback the spec on bootstrap failure.
- **Upgrade churn.** Existing repos have many snapshotless inbox specs. Mitigation: explicit migration via `aigon doctor --fix` / init bootstrap; do not hide this behind a dashboard read.

## Dependencies
- **Builds on F294** (already merged) — F294 deleted the compat branches; this feature makes the invariant true instead of approximately true.
- **Soft: the narrow b1db12d3 fix** — can be deleted once this ships. Not a hard dependency.
- No other hard deps.

## Out of Scope
- Changing `feature-prioritise` to assign numeric ID at a different time (e.g., at create). Keep prioritise as the ID-assignment point; re-key the snapshot at that moment.
- Generic engine-side multi-ID support (e.g., keeping both slug and numeric IDs as aliases). Overcomplicated; a rename is simpler.
- Non-feature/research entities (feedback). Feedback has its own state model; out of scope.
- Deleting the `buildMissingSnapshotState` function entirely. Keep it as the null-fallback for genuinely broken rows.

## Open Questions
- Should the re-key helper move into `lib/workflow-core/engine.js` now, or stay in `lib/entity.js` temporarily and be promoted later? Lean: move it into workflow-core now so identity migration sits with bootstrap / snapshot ownership.
- Should `aigon init` bootstrap inbox slug specs as well as numeric backlog/done entities, or should that remain solely `aigon doctor --fix`? Lean: both, as long as the bootstrap path stays explicit and write-side.

## Related
- b1db12d3 — narrow fix that restored the Prioritise button for inbox cards after F294's COMPAT_INBOX deletion. This feature closes the class properly.
- F294 (legacy-compat-path-cleanup) — deleted the compat branches this feature makes unnecessary.
- `4df8fe9d` — `feature-reset` re-bootstraps engine state post-wipe; same pattern this feature applies to create.
- CLAUDE.md rule 9 (added this session): fix the class, not the instance. b1db12d3 was the instance fix; this is the class fix.
- CLAUDE.md § Write-Path Contract — the invariant this feature makes structurally true.
