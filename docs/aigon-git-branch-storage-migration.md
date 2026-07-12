# Migrating the aigon repo to git-branch storage

Operator runbook for moving **this repository** (`~/src/aigon`) from the default
**local** SpecStore backend to **git-branch** storage on the orphan branch
`aigon-state`.

Canonical architecture: [`specstore-architecture.md`](specstore-architecture.md).
Brewboard was migrated to **stable spec layout** first; aigon is still on
**legacy stage folders** — that is orthogonal to storage (you can convert
storage before or after `spec-layout migrate --stable`).

## What changes

| Before (local) | After (git-branch) |
|----------------|-------------------|
| Workflow events are authoritative only under `.aigon/workflows/**` on disk | Canonical events live on orphan branch `refs/heads/aigon-state` as `specs/<KEY>/events.jsonl` |
| No cross-machine workflow sync without copying `.aigon/` | `aigon storage sync` fetch/merge/pushes lifecycle state; normal `git pull` on `main` is still how code + spec markdown travel |
| Leases are advisory events in local logs | Leases are CAS files on the state branch (`leases/<KEY>.json`) |
| Spec markdown + code on `main` | Unchanged — still on `main` |

Local `.aigon/workflows/**` becomes a **projection cache** rebuilt after each
sync. Under legacy layout, stage-folder spec paths are unchanged until you run
`aigon spec-layout migrate --stable` separately.

## Prerequisites

1. **Push access to `origin`** — convert creates and pushes `aigon-state` the
   first time it runs (`origin` → `https://github.com/jayvee/aigon.git`).
2. **Clean `main` working tree** — commit or stash unrelated WIP before convert;
   the command writes `.aigon/config.json` and pushes a new branch.
3. **No half-finished feature worktrees** (or accept the risk) — active entities
   with legacy spec paths are easier to reason about after pause/reset/close.
4. **Current aigon CLI** — run from this checkout (`aigon server restart` after
   any `lib/` edits).

## Pre-flight (read-only)

```bash
cd ~/src/aigon

# Storage health + lease warnings
aigon storage doctor
aigon storage status    # expect: Backend: local

# Layout (informational — not a storage blocker)
aigon spec-layout status

# Preview import size (aigon ≈ 655 numbered spec keys today)
aigon storage convert --backend=git-branch --remote=origin --dry-run
```

Fix advisory issues before convert:

```bash
aigon storage doctor --fix   # projection drift, expired lease cleanup, etc.
aigon doctor --fix           # general repo repair
```

Commit and push `main` so the post-convert state is easy to roll back against.

## Convert (one-time)

```bash
cd ~/src/aigon

# Optional: create a safety branch
git switch -c chore/git-branch-storage-migration

aigon storage convert --backend=git-branch --remote=origin
```

What convert does:

1. Imports existing numeric workflow events from `.aigon/workflows/{features,research}/*/events.jsonl` into the `aigon-state` tree.
2. Verifies event ids per spec key (`F1`, `R48`, …).
3. Writes `.aigon/config.json`:

   ```json
   {
     "storage": {
       "backend": "git-branch",
       "git": {
         "remote": "origin",
         "branch": "aigon-state",
         "offline": false
       }
     }
   }
   ```

4. Fetches/merges/pushes `aigon-state` to `origin`.
5. Rebuilds local projections and refreshes the lifecycle symlink view when
   `specLayout: stable` (no-op while aigon is still legacy).

Commit the config change on `main` (or your migration branch) and push **both**
`main` and the new state branch:

```bash
git add .aigon/config.json
git commit -m "chore: enable git-branch SpecStore (aigon-state on origin)"
git push origin HEAD
git push origin aigon-state
```

Rollback hint (printed by convert): set `"storage": { "backend": "local" }` in
`.aigon/config.json` — local projections remain on disk.

## Post-convert verification

```bash
aigon storage status     # Backend: git-branch, health ok, ahead/behind 0
aigon storage doctor     # no errors
aigon storage sync       # idempotent second sync

# Dashboard: Settings → storage panel shows git-branch + branch health
```

Regression harness (two-machine contract from F612):

```bash
cd ~/src/aigon
node tests/integration/two-clone-git-branch-storage.test.js
```

Smoke a real lifecycle transition on `main` and confirm:

- Event appended locally and visible after `aigon storage sync`.
- `git log origin/aigon-state` shows a new commit when workflow state changes.
- `main` has **no** spurious commits from storage sync (projection rebuild is
  read-only for tracked spec files — F666).

## Day-2 operations

| Task | Command |
|------|---------|
| Pull remote workflow state | `aigon storage sync` (after `git fetch`; does not replace `git pull` on `main`) |
| Check health | `aigon storage status` / `aigon storage doctor` |
| Offline work | Set `"offline": true` under `storage.git` — mutating commands queue until sync returns |
| Portfolio view | `aigon board --storage` |

Mutating lifecycle commands (`feature-start`, `feature-close`, …) call
pre-write sync on git-branch storage unless offline mode is set.

## Optional: stable spec layout (separate migration)

Aigon still uses **legacy stage folders** (~664 specs). Storage convert does
**not** move spec markdown. When ready for the stable-layout cutover:

```bash
aigon spec-layout migrate --stable --dry-run   # ~640 moves + 26 slug→ID assignments
aigon spec-layout migrate --stable --yes
git push origin main
```

Recommended order for this repo:

1. **Git-branch storage** (workflow state portable across clones) — this doc.
2. **Stable layout** (canonical `00-specs/` + generated symlinks) — when you want
   to stop lifecycle folder moves on `main`.

Brewboard already completed step 2 only (still `storage: local`).

## Aigon-specific notes

- **Scale:** dry-run currently imports **655** numbered spec keys; expect a
  large first push to `aigon-state`.
- **Expired leases:** `storage doctor` may list many `expired_unreleased_lease`
  warnings from old feature work — run `aigon storage doctor --fix` before
  convert.
- **Do not use legacy `git-ref`:** if `storage.backend` is `git-ref`, convert
  loudly rejects it; only `local` → `git-branch` is supported.
- **Worktrees:** after convert, each worktree shares the repo’s
  `.aigon/config.json`; run `aigon storage sync` in the worktree after pulling
  state from another machine.
- **Seeds / brewboard:** demo repos are independent; migrate them with the same
  commands when you want cross-clone workflow sync there.

## Related docs

- [`specstore-architecture.md`](specstore-architecture.md) — backends, leases, layout interaction
- [`architecture.md`](architecture.md) — module map, write-path contract
- Site reference: `site/content/reference/commands/storage/` (user-facing command docs)
