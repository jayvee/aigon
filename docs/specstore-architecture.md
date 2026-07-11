# SpecStore Architecture

> Maintainer note for SpecStore storage. Features 573-578 introduced the boundary, local backend, git-backed sync, and leases; features 595-598 hardened stats sync, dashboard visibility, conversion, and two-clone regression coverage; features 609-613 replaced per-spec Git refs with the `git-branch` orphan-branch backend and removed legacy `git-ref`.

## Purpose

Aigon is a spec-driven development (SDD) tool. The durable work object is a **spec**, not a generic entity record or an ad-hoc file path scattered across command modules. `SpecStore` is the single storage boundary for durable spec state.

## Top-level model

| Concept | Description |
|---------|-------------|
| **Spec** | The durable work object — human/agent-facing markdown plus engine-backed events and snapshots. |
| **Spec kind** | `feature` or `research`. These are the only top-level spec kinds in the target architecture. |
| **Spec key** | Stable identity string: `F42` (feature #42), `R43` (research #43). Parsed and formatted by `lib/spec-identity.js` (re-exported from `lib/spec-store/spec-key.js` for store callers). |
| **Events** | Append-only lifecycle log (`events.jsonl`). Source of truth for workflow semantics. Git-branch storage stores canonical events as `specs/<KEY>/events.jsonl` on an orphan branch. |
| **Snapshot** | Derived point-in-time projection (`snapshot.json`). Disposable cache of projector output; never the cross-machine authority. |
| **Leases** | On `git-branch`, authoritative CAS lease files (`leases/<KEY>.json`) plus audit `lease.*` events in the canonical log (F610). Local backend uses advisory lease events only. Default TTL 30 min; renew checkpoints at most every 10 min. |
| **Indexes** | Future read-optimised lookups (dashboard spec index today; SpecStore indexes later). |
| **Projections** | Human-facing and local artefacts derived from durable state — spec markdown files, folder placement, snapshots, and analytics cache files. |

### Feedback is not a spec kind

Customer feedback is **not** a top-level spec kind. It is represented as **research origin/source metadata** on research specs (see feature 574). Feedback commands and folders may persist during migration, but the long-term model treats feedback as input to research, not a parallel durable object.

## Layering

```
┌─────────────────────────────────────────────────────────────┐
│  Commands, dashboard collectors, agents                     │
└───────────────────────────┬─────────────────────────────────┘
                            │ lifecycle semantics
┌───────────────────────────▼─────────────────────────────────┐
│  workflow-core (XState machine, projector, effects)         │
└───────────────────────────┬─────────────────────────────────┘
                            │ durable storage protocol
┌───────────────────────────▼─────────────────────────────────┐
│  SpecStore (list/read specs, events, snapshots, locks)      │
└───────────────────────────┬─────────────────────────────────┘
                            │ backends
              ┌─────────────┴─────────────┐
              │ local (573) │ git-branch (609) │
              └─────────────────────────────┘

Spec markdown files  = projections (human/agent-facing)
Folder stage dirs    = derived from lifecycle (UX visibility, not authority)
```

**SpecStore** owns the durable storage protocol — how events, snapshots, locks, leases, and spec bodies are read and written.

**workflow-core** owns lifecycle semantics — which transitions are valid, what events mean, and how snapshots are projected.

**Spec files** (`docs/specs/features/`, `docs/specs/research-topics/`) remain human/agent-facing projections. They are not the authority for lifecycle state.

**Folders** (`01-inbox` … `06-paused`) are derived from lifecycle for UX. Folder position must not be treated as the sole source of truth when an engine snapshot exists.

## SpecStore interface

Module: `lib/spec-store/`. Factory: `createSpecStore({ repoPath, storage?: resolveStorageConfig(repoPath) })`.

| Method | Role |
|--------|------|
| `listSpecs()` | Enumerate numbered specs visible under `docs/specs/` |
| `readSpec(key)` | Read spec markdown body |
| `readEvents(ref)` / `readEventsSync(ref)` | Read append-only workflow, lease, and canonical stats events |
| `appendEvent(ref, event)` | Append one event, with git-branch pre-write sync when enabled |
| `readSnapshot(ref)` / `readSnapshotSync(ref)` | Read derived snapshot cache |
| `writeSnapshot(ref, snapshot)` | Write derived snapshot cache |
| `lock(ref, work, options?)` | Local exclusive critical section (`try`, `retry: false`) |
| `sync()` | Backend sync hook; local is a no-op, git-branch imports/merges/pushes the state branch |
| `health()` | Backend health probe for CLI/dashboard status |
| `acquireLease` / `renewLease` / `releaseLease` / `readLeases` | Lease coordination (CAS files on git-branch; advisory events on local) |

The local backend thin-wraps workflow-core files. The git-branch backend stores canonical event streams on an orphan branch and rebuilds the local workflow projection after sync. Non-engine callers still use `lib/workflow-core/persistence-compat.js` where they need compatibility shims.

## Spec keys

- **Format:** `<KindLetter><Number>` where kind letter is `F` (feature) or `R` (research).
- **Examples:** `F42`, `R7`, `R100`.
- **Malformed keys** (`X1`, `F`, empty string) throw `SpecKeyError` — no silent coercion.

Identity helpers for `{ key, number, kind, slug }` shipped in feature 575. SpecStore keys address numbered specs; slug-keyed inbox entities remain workflow ids until prioritise assigns a number.

## Storage backends

### Local backend

Default backend. No storage config is required:

```json
{
  "storage": {
    "backend": "local"
  }
}
```

Lifecycle events, snapshots, locks, and projection files remain local under `.aigon/workflows/**`. Normal Git still carries spec markdown and code changes.

### Git-branch backend

Opt-in backend. Enable with `aigon storage convert --backend=git-branch --remote=origin` or set `.aigon/config.json` manually:

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

| Concern | Behaviour |
|---------|-----------|
| **Canonical store** | File tree on orphan branch `aigon-state` (default): `meta.json`, `specs/<KEY>/events.jsonl`, `leases/<KEY>.json` |
| **Local projection** | `.aigon/workflows/**` remains the read cache; sync rebuilds events, snapshots, and stats projections locally. **Projection rebuild is read-only for the checked-out branch** — it never moves spec markdown, stages files, or creates commits on `HEAD`; folder drift is surfaced via read-model diagnostics until explicit repair (`aigon repair`) or a generated lifecycle view (set member 669). |
| **Sync** | `aigon storage sync` fetch+merge+push for `refs/heads/<branch>`; `aigon storage status` reports health |
| **Pre-write sync** | Mutating commands fetch+merge before append unless offline |
| **Merge** | Union/dedupe by event `id` per spec key |
| **First sync import** | Existing numeric local workflow events are imported into the branch before remote merge/push |
| **Stats** | Canonical `stats.recorded` events sync through the branch; local `stats.json` is a projection |

Module: `lib/spec-store/git-branch-backend.js` (+ `git-plumbing.js`, `event-merge.js`, `projection.js`, `storage-config.js`).

### Legacy git-ref migration (F613)

`storage.backend: "git-ref"` is **rejected** at runtime with the exact convert command to run — no silent fallback to `local`. Import-only readers for `refs/aigon/specs/*/events` live in `lib/spec-store/convert.js` so the old backend module could be deleted while conversion remains supported.

## Spec layout: canonical `00-specs` (F668)

Durable spec markdown has a **lifecycle-independent canonical home**:

- Features: `docs/specs/features/00-specs/`
- Research: `docs/specs/research-topics/00-specs/`

`00-specs` is owned by `lib/workflow-core/paths.js` (`CANONICAL_SPEC_DIR`,
`getCanonicalSpecDirForEntity`) and is deliberately **not** a member of
`CANONICAL_STAGE_DIRS` — the stage resolver never treats it as a stage, so a
canonical file is never double-counted alongside a stage copy.

| Concern | Behaviour |
|---------|-----------|
| **Layout version** | `specLayout: "stable" \| "legacy"` in the tracked `.aigon/config.json`. Committed, so every clone/worktree agrees after normal Git sync. Storage backend selection (local vs git-branch) never alters the layout. |
| **New creates** | Under `stable`, `feature-create`/`research-create` write the numbered, immutable canonical file directly into `00-specs`; under `legacy` they write into `01-inbox` as before. |
| **Resolution** | `lib/feature-spec-resolver.js` returns the canonical file (`source: 'canonical'`) whenever one exists; it falls back to legacy stage discovery only when no canonical file exists. Symlinks are excluded from canonical discovery by `lstat`, never by filename heuristics. |
| **Lifecycle view** | `lib/spec-view.js` generates disposable relative symlinks in lifecycle folders after workflow state is published. Lifecycle commands refresh this view under `stable`; they do not move canonical spec markdown or create commits for lifecycle-only transitions. |
| **Migration** | Explicit, validated command — never runs from `aigon apply`, dashboard startup, storage polling, or any read path. |

Module: `lib/spec-layout.js` (canonical-path API, status, and the
plan→validate→apply→commit migration engine). Command wiring:
`lib/commands/spec-layout.js`.

### `aigon spec-layout`

| Command | Role |
|---------|------|
| `aigon spec-layout status` | Read-only report: `legacy` / `mixed` / `migration-blocked` / `stable`, canonical vs legacy counts, warnings, blockers. Never writes. |
| `aigon spec-layout migrate --stable --dry-run` | Deterministic move/collision plan; performs no writes. |
| `aigon spec-layout migrate --stable [--yes]` | Validates IDs, duplicate specs, destination collisions, dirty relevant files, and paths outside Aigon spec roots before moving anything. `git mv` preserves rename history; unnumbered inbox specs receive IDs via the feature-2 create-time reservation contract; numbered specs keep their IDs. Commits only the explicit migration paths + the layout-version config. `--yes` acknowledges active entities (in-progress / in-evaluation) whose worktree/branch still references the legacy path until it merges. |

Migration is **idempotent and recoverable**: a completed run re-runs as a no-op;
an interrupted run (canonical copy written but stage source still present) is
diagnosed and resumed by removing the stale source.

> **Final authority model.** Workflow state (`.aigon/workflows/**`, or the
> canonical `aigon-state` branch for git-branch storage) owns lifecycle. The
> canonical spec file stays under `00-specs`; lifecycle folders are a generated
> local navigation view. `move_spec` events from legacy histories remain
> replayable metadata, but under `stable` they refresh the view instead of
> mutating tracked spec content.

Legacy `specLayout: "legacy"` remains available for the compatibility window so
unmigrated repositories can keep the stage-folder write model. New lifecycle
development should target `stable`; `aigon spec-layout migrate --stable` is the
documented cutover path.

## CLI, leases, doctor, and reporting

| Command | Role |
|---------|------|
| `aigon storage convert --backend=git-branch --remote=origin [--branch=aigon-state] [--keep-refs] [--dry-run]` | Migrate from `local` or legacy `git-ref`; verify event ids; flip config; delete legacy refs unless `--keep-refs` |
| `aigon storage sync` | Fetch, merge/dedupe, rebuild local projections, and push the state branch |
| `aigon storage status` | Show backend, remote/branch, offline state, last sync, ahead/behind, and health |
| `aigon storage doctor [--fix]` | Read-only diagnostics: branch reachability, duplicate event ids, projection drift, lease health; flags legacy `git-ref` config |
| `aigon storage report [--json]` | Cross-repo read-only report from configured git-branch repos |
| `aigon board --storage` | Portfolio view of active leases across repos |

## Dashboard visibility

`lib/dashboard-storage.js` is the server-owned DTO boundary for storage visibility:

- Settings and repo metadata expose the resolved backend, health, remote, branch, offline state, last sync, ahead/behind, and storage actions.
- Legacy `git-ref` config surfaces `git-ref-removed` with the convert hint — never a silent degrade.
- Feature and research rows attach active leases from branch lease files (git-branch) or derived events (local).

## Related features

| Feature | Scope |
|---------|-------|
| 573 | This document + `lib/spec-store/` skeleton |
| 574 | Deprecate feedback into research origins |
| 575 | Repo-wide spec identity keys |
| 576 | Route workflow-core persistence through local SpecStore |
| 577 | Git-ref SpecStore backend (removed F613) |
| 578 | Sync, leases, reporting |
| 595 | Canonical stats sync and projection rebuild |
| 596 | Dashboard storage status and active lease visibility |
| 597 | `aigon storage convert` (git-ref era) |
| 598 | Two-clone git-ref storage regression harness (superseded by 612) |
| 609 | Git-branch backend core |
| 610 | CAS leases on branch |
| 611 | Git-branch observability |
| 612 | Two-clone git-branch race harness |
| 613 | Convert to git-branch + git-ref removal |

## Reading order

1. This document — storage boundary and layering
2. [`docs/architecture.md`](architecture.md) — full codebase map (workflow-core, dashboard read models)
3. `lib/spec-store/index.js` — module entry and factory
