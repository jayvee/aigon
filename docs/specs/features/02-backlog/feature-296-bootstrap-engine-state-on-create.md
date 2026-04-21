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

This feature closes the invariant: **every entity has a workflow-core snapshot from the moment its spec file is written**. `feature-create` and `research-create` call `ensureEntityBootstrapped` at `inbox` lifecycle as part of their normal flow. Inbox entities use the slug as the engine entity-id. `feature-prioritise` transitions from slug-keyed state to numeric-keyed state via an engine-level migration event (renaming the `.aigon/workflows/features/<slug>/` directory to `.aigon/workflows/features/<numeric-id>/` atomically, or a `features.id_assigned` event that re-keys the snapshot).

After this feature:
- No "missing snapshot" read-model fallback is needed. `buildMissingSnapshotState` can return truly empty (no actions) because it only fires for *actually broken* state — no longer for the normal "just-created inbox" case.
- `feature-reset`'s re-bootstrap call (`4df8fe9d`) becomes one of several producers, not the only survivor.
- F294's `COMPAT_INBOX` deletion is retroactively correct — no live producer of snapshotless-inbox state remains.
- The b1db12d3 narrow fix (stage-derived actions on missing snapshots) becomes a belt-and-braces fallback; it's rarely hit in practice because inbox entries now have proper snapshots.

## Desired Outcome
The Write-Path Contract invariant — "every entity has an engine snapshot" — is structurally true, not approximately true. A maintainer can delete compat read paths with confidence because the only producer of snapshotless state is "someone hand-edited a spec file into the repo without going through the CLI" — a policy violation, not a routine flow.

## User Stories
- [ ] As a maintainer, when I delete a compat read path, I'm not retroactively breaking live producers — because `feature-create` + `research-create` + `feature-reset` all produce proper snapshots.
- [ ] As the dashboard, when I render an inbox card, I read from the snapshot like I do for every other stage — no `buildMissingSnapshotState` fallback.
- [ ] As an agent running `aigon feature-spec <slug>`, the engine resolves the spec via snapshot lookup — no slug/numeric-ID mismatch edge case.
- [ ] As the operator after `aigon feature-prioritise`, the ID transitions from slug → numeric atomically. Engine state moves with the folder. No new "half-migrated" states possible.
- [ ] As a future feature writer, if my read path assumes a snapshot exists, that assumption is safe.

## Acceptance Criteria
- [ ] `entityCreate` in `lib/entity.js` calls `ensureEntityBootstrapped(repoPath, entityType, slug, 'inbox')` after writing the spec file. Failure is fatal — the spec file is rolled back (or the bootstrap happens atomically with the file write).
- [ ] Engine state for inbox entities lives at `.aigon/workflows/{features,research}/<slug>/` — slug as directory name. Directory names with non-numeric characters are safe (the path resolver already tolerates them; verify no assumption breaks).
- [ ] `entityPrioritise` in `lib/entity.js` (shared factory) transitions the snapshot from slug-keyed to numeric-keyed. Options:
  - **(a)** File-move: atomically rename `.aigon/workflows/features/<slug>/` → `.aigon/workflows/features/<paddedId>/`, patch `snapshot.json.entityId` and all event `featureId` fields.
  - **(b)** Engine event: emit `feature.id_assigned { fromSlug, toId }` on the slug-keyed stream, then flush a new numeric-keyed snapshot, then delete the slug-keyed directory in a `move_spec`-style effect.
  - Pick one; document in the spec's Technical Approach. (Lean: (a) — atomic rename is simpler and avoids a one-off event type.)
- [ ] `listVisibleSpecMatches` and related path resolvers tolerate slug-keyed engine state directories alongside numeric-keyed. Test: inbox entity with slug, backlog entity with numeric — both visible, no collision.
- [ ] `workflow-read-model.js` `buildMissingSnapshotState` is simplified: remove the narrow stage-action derivation from b1db12d3. With this feature in place, missing snapshots only occur for genuinely broken state. Keep the function as a null-return fallback for truly absent entities; stop calling it on the normal inbox path.
- [ ] `feature-reset` (already re-bootstraps via `4df8fe9d`) continues to work — verify the reset → slug-keyed flow still holds for any entity that moved back to inbox post-prioritise (edge case: the engine may need to re-slug-key during reset).
- [ ] Dashboard reads inbox actions from the snapshot like every other stage — no code path checks for "null snapshot" as a normal case.
- [ ] Migration for existing repos: one-shot script or lazy-migrate on dashboard read. If a spec exists in `01-inbox/` without a snapshot, bootstrap it on first read. Document the behaviour.
- [ ] Regression tests:
  - `feature-create foo` creates both the spec file AND the snapshot; removing either leaves a broken state with a clear error.
  - `feature-prioritise foo` migrates slug-keyed → numeric-keyed; post-prioritise, slug directory is gone, numeric directory exists with the bootstrap event + any prioritise events.
  - `feature-create foo && feature-reset foo` round-trips correctly (slug → slug; or slug → numeric → slug if reset reverts prioritise too).
  - Dashboard renders inbox card actions from snapshot, not from the stage fallback.
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
The engine already tolerates non-numeric entity IDs in its path layer (see `lib/workflow-core/paths.js` — no hardcoded numeric regex on entity-id). The concerns are:

1. **Path resolver collisions.** `listVisibleSpecMatches` currently scans canonical stage folders for `feature-<id>-<desc>.md`. A slug-keyed entity's spec doesn't have a numeric id prefix, so it matches the "name-only" branch (already in use for backlog/inbox slug entities). Verify the branch correctly handles "slug has snapshot" without regressing.
2. **Snapshot filename.** `.aigon/workflows/features/<slug>/snapshot.json` — slug contains hyphens, safe for directory names. No other gotchas expected.
3. **ID uniqueness.** Slugs are unique per-repo (enforced by `aigon feature-create` rejecting existing slugs). Good enough.

### Prioritise as re-keying
Current `entityPrioritise` moves the spec file from `01-inbox/` to `02-backlog/` and renames it with a numeric ID prefix. Adding the engine re-key:
- **Option (a) atomic directory rename** (preferred). Rename `.aigon/workflows/features/<slug>/` → `.aigon/workflows/features/<paddedId>/`, then rewrite `snapshot.json` + each event in `events.jsonl` to replace the `featureId` field. Under the same file lock. Treat as a single engine mutation ("feature.id_assigned" event that, as a side effect, rewrites references).
- **Option (b) emit event + new snapshot** — double the state during transition. Rejected — more moving parts, more failure modes.

### Migration path for existing repos
Any current repo has a pile of pre-existing inbox spec files with no snapshots (this was the normal state until now). First dashboard read after this feature ships:
- Detect inbox spec without snapshot → lazy-bootstrap in-place.
- OR: `aigon doctor --fix` does a one-shot pass.
- Document which and when. (Lean: lazy-bootstrap silently. Makes upgrade free.)

### Belt-and-braces fallback
Keep `buildMissingSnapshotState` as a null-return for genuinely-broken rows (e.g., someone `rm -rf`'d the `.aigon/workflows/` directory). Remove the stage-action derivation added in b1db12d3 — that fallback becomes unnecessary once the normal path doesn't produce snapshotless state.

### Interaction with F294
F294's core principle ("every entity has a snapshot") becomes retroactively correct once this feature lands. F294's audit was right about the destination; this feature builds the producer discipline that makes it safe.

### Risk
- **Re-keying atomicity.** If the prioritise rename fails mid-way, you get a half-migrated state. Mitigation: use `fs.renameSync` on the directory (single atomic operation on most filesystems) BEFORE rewriting event contents; if rename succeeds but rewrite fails, the events still reference the old slug — recover by fixing or deleting and re-bootstrapping.
- **Concurrent create + read.** Dashboard polls could see the spec file after it's written but before the snapshot finishes. Mitigation: write order is "snapshot first, spec second" — dashboard sees spec after snapshot exists.
- **Upgrade churn.** Existing repos have many snapshotless inbox specs. Lazy-bootstrap handles this transparently on read; users don't notice.

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
- Lazy-bootstrap on dashboard read vs. explicit `aigon doctor --fix` migration: lean lazy, but either is fine. (Lean: lazy + a line in the next release notes.)
- Should the re-key at prioritise be a proper engine event (auditable in events.jsonl) or a silent directory rename? (Lean: silent rename + a `feature.prioritised` event that references both ids. Event is the audit trail.)
- Do research entities need the same treatment? (Yes — `research-create` has the same gap. Pair them in one feature.)

## Related
- b1db12d3 — narrow fix that restored the Prioritise button for inbox cards after F294's COMPAT_INBOX deletion. This feature closes the class properly.
- F294 (legacy-compat-path-cleanup) — deleted the compat branches this feature makes unnecessary.
- `4df8fe9d` — `feature-reset` re-bootstraps engine state post-wipe; same pattern this feature applies to create.
- CLAUDE.md rule 9 (added this session): fix the class, not the instance. b1db12d3 was the instance fix; this is the class fix.
- CLAUDE.md § Write-Path Contract — the invariant this feature makes structurally true.
