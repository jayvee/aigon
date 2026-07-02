# SpecStore Architecture

> Maintainer note for SpecStore storage. Features 573-578 introduced the boundary, local backend, git-ref backend, sync, and leases; features 595-598 hardened stats sync, dashboard visibility, conversion, and two-clone regression coverage.

## Purpose

Aigon is a spec-driven development (SDD) tool. The durable work object is a **spec**, not a generic entity record or an ad-hoc file path scattered across command modules. `SpecStore` is the single storage boundary for durable spec state.

## Top-level model

| Concept | Description |
|---------|-------------|
| **Spec** | The durable work object — human/agent-facing markdown plus engine-backed events and snapshots. |
| **Spec kind** | `feature` or `research`. These are the only top-level spec kinds in the target architecture. |
| **Spec key** | Stable identity string: `F42` (feature #42), `R43` (research #43). Parsed and formatted by `lib/spec-identity.js` (re-exported from `lib/spec-store/spec-key.js` for store callers). |
| **Events** | Append-only lifecycle log (`events.jsonl`). Source of truth for workflow semantics. Git-ref storage stores canonical events in Git refs. |
| **Snapshot** | Derived point-in-time projection (`snapshot.json`). Disposable cache of projector output; never the cross-machine authority. |
| **Leases** | Advisory cross-machine coordination via append-only `lease.*` events in the canonical log (feature 578). Default TTL 30 min; renew checkpoints at most every 10 min. |
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
              │ local (573) │ git-ref (577) │
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
| `appendEvent(ref, event)` | Append one event, with git-ref pre-write sync when enabled |
| `readSnapshot(ref)` / `readSnapshotSync(ref)` | Read derived snapshot cache |
| `writeSnapshot(ref, snapshot)` | Write derived snapshot cache |
| `lock(ref, work, options?)` | Local exclusive critical section (`try`, `retry: false`) |
| `sync()` | Backend sync hook; local is a no-op, git-ref imports/merges/pushes canonical refs |
| `health()` | Backend health probe for CLI/dashboard status |
| `acquireLease` / `renewLease` / `releaseLease` / `readLeases` | Advisory lease events layered onto the same canonical event stream |

The local backend thin-wraps workflow-core files. The git-ref backend stores canonical event streams in refs and rebuilds the local workflow projection after sync. Non-engine callers still use `lib/workflow-core/persistence-compat.js` where they need compatibility shims.

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

### Git-ref backend

Opt-in backend. Enable with `aigon storage convert --backend=git-ref --remote=origin` or set `.aigon/config.json` manually:

```json
{
  "storage": {
    "backend": "git-ref",
    "git": {
      "remote": "origin",
      "refPrefix": "refs/aigon/specs",
      "offline": false
    }
  }
}
```

| Concern | Behaviour |
|---------|-----------|
| **Canonical store** | Append-only event payloads in Git refs at `<refPrefix>/<key>/events` (e.g. `refs/aigon/specs/F42/events`) |
| **Local projection** | `.aigon/workflows/**` remains the read cache; sync rebuilds events, snapshots, and stats projections locally; `readEventsSync` / `readSnapshotSync` never hit the network |
| **Sync** | `aigon storage sync` fetch+merge+push for `<refPrefix>/*`; `aigon storage status` reports health |
| **Pre-write sync** | Mutating commands fetch+merge before append unless `storage.git.offline: true`, `--offline`, or `AIGON_STORAGE_OFFLINE=1` |
| **Merge** | Union/dedupe by event `id`; merge commits keep push fast-forwardable |
| **First sync import** | Existing numeric local workflow events are imported into canonical refs before remote merge/push |
| **Stats** | Canonical `stats.recorded` events sync through refs; `.aigon/workflows/**/stats.json` and `.aigon/cache/stats-aggregate.json` are local projections/caches rebuilt from canonical data where available |

Module: `lib/spec-store/git-ref-backend.js` (+ `git-plumbing.js`, `event-merge.js`, `projection.js`, `storage-config.js`).

Key-addressed refs (`refs/aigon/specs/<key>/events`) were chosen over UUID-addressed paths so CLI, dashboard, and Git artefacts stay aligned.

## CLI, leases, doctor, and reporting

Advisory cross-machine coordination uses append-only lease events in the same canonical log as workflow events:

| Event type | Purpose |
|------------|---------|
| `lease.acquired` | Session start — records holder, agent, role, TTL |
| `lease.renewed` | Rate-limited checkpoint (default: at most every **10 min** while session alive) |
| `lease.released` | Explicit release |
| `lease.taken_over` | Auditable takeover when another machine uses `--takeover` |

Defaults: **TTL 30 min**, renew checkpoint **10 min**. Expiry is derived from the latest unreleased event's `expiresAt` vs wall clock — no separate expiry event. Heartbeats stay local/display-only; only lease renewals append to Git when the advertised expiry window changes.

| Command | Role |
|---------|------|
| `aigon storage convert --backend=git-ref --remote=origin` | Validate remote push access, write storage config, import existing local projection events, and sync |
| `aigon storage sync` | Fetch, merge/dedupe, rebuild local projections, and push canonical refs |
| `aigon storage status` | Show backend, remote/ref prefix, offline state, last sync, ahead/behind, and health |
| `aigon storage doctor [--fix]` | Read-only diagnostics: ref reachability, duplicate event ids, projection drift, lease health |
| `aigon storage report [--json]` | Cross-repo read-only report from configured repos / bare mirrors under `~/.aigon/remotes/` |
| `aigon board --storage` | Portfolio view of active leases across repos |

**Git remote permissions:** push access to `refs/aigon/*` is required for sync. Hosting UIs (GitHub/GitLab/Bitbucket) may not display custom refs — use `git ls-remote` or `aigon storage status`.

## Dashboard visibility

`lib/dashboard-storage.js` is the server-owned DTO boundary for storage visibility:

- Settings and repo metadata expose the resolved backend, health, remote, ref prefix, offline state, last sync, ahead/behind, and storage actions.
- Feature and research rows/detail payloads attach active, non-expired leases from canonical events.
- The frontend renders only these DTOs; it does not derive backend or lease state from raw files.

## Related features

| Feature | Scope |
|---------|-------|
| 573 | This document + `lib/spec-store/` skeleton |
| 574 | Deprecate feedback into research origins |
| 575 | Repo-wide spec identity keys |
| 576 | Route workflow-core persistence through local SpecStore |
| 577 | Git-ref SpecStore backend |
| 578 | Sync, leases, reporting |
| 595 | Canonical stats sync and projection rebuild for git-ref storage |
| 596 | Dashboard storage status and active lease visibility |
| 597 | `aigon storage convert` |
| 598 | Two-clone git-ref storage regression harness |

## Reading order

1. This document — storage boundary and layering
2. [`docs/architecture.md`](architecture.md) — full codebase map (workflow-core, dashboard read models)
3. `lib/spec-store/index.js` — module entry and factory
