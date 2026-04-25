---
id: 5
title: "feature-pause on inbox items skips move_spec effect"
status: "inbox"
type: "bug"
reporter:
  name: ""
  identifier: ""
source:
  channel: ""
  reference: ""
---

## Summary

`aigon feature-pause <id>` on an inbox or backlog feature persists a `feature.paused` event but **does not emit a `move_spec` effect** to relocate the spec from `01-inbox/` (or `02-backlog/`) to `06-paused/`. The engine path (for `implementing`-state pauses) does emit `move_spec`; the pre-start path in `lib/entity.js:pausePrestartEntity` does not. The CLI also prints `✅ Paused: <file> -> 06-paused/` even though the file never moved — the success message is a lie.

This is the same write-path-contract failure class as F285→F293 (CLAUDE.md "fix the producer of the bad state"). The producer (pause action) writes one half of the required state (the event) but not the other (the file move), leaving disk diverged from the engine projection.

## Evidence

Encountered 2026-04-25 while pausing F252 / F253 (multiuser-3-committed-state, multiuser-4-team-mode-sync):

```
$ aigon feature-pause 252
✅ Feature 252 is already paused.    # second run; first run also "succeeded"
$ ls docs/specs/features/01-inbox/ | grep 252
feature-252-multiuser-3-committed-state.md   # still in inbox
$ cat .aigon/workflows/features/252/snapshot.json | grep currentSpecState
"currentSpecState": "inbox",                 # snapshot.json stale; events.jsonl has paused event
```

Recovery required:
1. `git mv` spec from `01-inbox/` to `06-paused/`
2. `rm .aigon/workflows/features/{id}/snapshot.json` to force engine reprojection
3. `aigon doctor --fix` to rebuild snapshot from event log

`aigon doctor` did **not** detect the disk/engine divergence on its own pass (only flagged after I removed the snapshots).

Code reference: `lib/entity.js:727-734` — `pausePrestartEntity` calls `persistEntityEvents` then prints success without ever computing or emitting a `move_spec` effect.

## Triage Notes

- **Class:** write-path-contract violation (CLAUDE.md F285→F293 pattern)
- **Severity:** medium — corrupts board view, requires manual recovery, but no data loss
- **Scope:** all entity types (`feature-pause`, `research-pause`, `feedback` if it has equivalent) since `pausePrestartEntity` is shared via `def.prefix`
- **Adjacent:** `aigon doctor` should detect snapshot/folder divergence as a known failure class, since this is the second time it's surfaced (F250 had a related but distinct corruption from a 2.58.0 sidecar replay)
- **Workaround:** none — corruption recovery requires manual `git mv` + snapshot delete + `doctor --fix`

## Proposed Next Action

Promote to feature. Two parts:

1. **Fix the producer:** `pausePrestartEntity` in `lib/entity.js` must emit a `move_spec` effect alongside the `feature.paused` event, mirroring the engine path at `lib/commands/feature.js:450`. Probably easiest to lift the effect emission into a shared helper used by both paths.

2. **Add doctor detection:** `aigon doctor` should compare `snapshot.specPath` against the actual file location for every entity and flag mismatches as `--fix`-able (rebootstrap snapshot from disk position + replay events).

Acceptance: after fix, `aigon feature-pause <inbox-id>` leaves the spec in `06-paused/` and `snapshot.json` reflects `lifecycle: paused` in the same write path. Regression test: pause an inbox feature, assert disk + snapshot agree.
