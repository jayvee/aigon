---
complexity: low
---

# Feature: research-write-path-cleanup

## Summary

Research state transitions (`research-prioritise → research-start → research-eval → research-close`)
leave stale spec file copies behind in the previous folder, breaking `getSpecPathForEntity`
when it later finds the same research id in two folders and bails with
`duplicate-matches-no-snapshot-hint`. Apply the same producer-side cleanup pattern that
**F296** applied to features (which fixed the matching feature-side bug) to research write paths.

## Concrete incident

On 2026-05-07 a brewboard research run (`research-02-offline-sync`) couldn't be closed.
Two file copies existed simultaneously:
- `02-backlog/research-02-offline-sync.md` (244-byte stub, leftover from prioritise)
- `03-in-progress/research-02-offline-sync.md` (2371-byte real research, current)

`aigon doctor --fix` resolved it (moved both to `04-in-evaluation/`, kept the canonical
copy), but doctor is the loud-recovery path. The producers should not leave the drift
behind in the first place.

## User Stories

- [ ] As a user prioritising → starting → evaluating → closing a research, I never end up with two file copies of the same research spec on disk.
- [ ] As a user, `research-close` succeeds without first running `aigon doctor --fix` to clean up producer drift.

## Acceptance Criteria

- [ ] `lib/commands/research.js` (or wherever `research-start`, `research-eval-start`, etc. live) cleans up the **previous** folder location after moving a research spec to its next folder. Specifically: if the file existed in `02-backlog/` and is being moved to `03-in-progress/`, the `02-backlog/` copy is removed in the same write transaction.
- [ ] Same cleanup pattern applies to every research lifecycle transition: `01-inbox → 02-backlog`, `02-backlog → 03-in-progress`, `03-in-progress → 04-in-evaluation`, `04-in-evaluation → 05-done`.
- [ ] Integration test: simulate a full research lifecycle (`research-create → research-prioritise → research-start → research-eval-start → research-close`) and assert exactly **one** file copy exists at every step. Test fails today (without this fix), passes after.
- [ ] `aigon doctor` after a clean lifecycle reports zero `spec-folder-drift` issues for research entries.
- [ ] Existing feature-side cleanup logic (F296 / `migrateEntityWorkflowIdSync`) is re-used or paralleled — do not duplicate the cleanup mechanism. If feature-side has a shared helper, research uses the same one; if not, factor one out and use it from both.

## Validation

```bash
npm run test:iterate
```

## Pre-authorised

- May skip `npm run test:browser` mid-iteration — this feature touches no dashboard assets.

## Technical Approach

**Reference**: F296 incident in `CLAUDE.md` ("Prioritise re-keys slug → numeric via `migrateEntityWorkflowIdSync` (F294/b1db12d3 incident: deleting compat read paths without fixing producers)"). Apply the same lesson here.

**Files likely to change:**
- `lib/commands/research.js` — research state transition handlers; add post-move cleanup of the prior folder
- `lib/workflow-core/paths.js` or `lib/workflow-core/entity-lifecycle.js` — if there's a shared move helper used by features, research can call it; if not, factor one
- `tests/integration/research-lifecycle.test.js` (new or existing) — full-cycle test asserting one-file invariant

**What this is NOT:**
- Not a doctor change (doctor's loud-recovery is fine; we just want to not need it)
- Not a state-machine change (engine state is correct; only the filesystem cleanup is at fault)
- Not retroactive — does not migrate existing drifts (doctor handles those)

## Dependencies

- F296 (feature-side write-path cleanup) — pattern to follow

## Out of Scope

- Dashboard rendering (separate work in F490 / F491+ tally)
- Adding new research lifecycle states or transitions
- Changing where research specs live in the folder hierarchy

## Open Questions

- None — the bug is well understood and the fix template exists in F296.

## Related

- Trigger incident: 2026-05-07, brewboard `research-02-offline-sync`, fixed via `aigon doctor --fix`
- Pattern: F296 (`migrateEntityWorkflowIdSync` for features)
- Set: <!-- standalone -->
