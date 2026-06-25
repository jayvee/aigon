# SpecStore Architecture

> Design note for the `specstore-git-backed-storage` feature set. Feature 573 introduces the vocabulary and module boundary; later features wire callers and add Git-ref backends.

## Purpose

Aigon is a spec-driven development (SDD) tool. The durable work object is a **spec**, not a generic entity record or an ad-hoc file path scattered across command modules. `SpecStore` is the single storage boundary for durable spec state.

## Top-level model

| Concept | Description |
|---------|-------------|
| **Spec** | The durable work object — human/agent-facing markdown plus engine-backed events and snapshots. |
| **Spec kind** | `feature` or `research`. These are the only top-level spec kinds in the target architecture. |
| **Spec key** | Stable identity string: `F42` (feature #42), `R43` (research #43). Parsed and formatted by `lib/spec-identity.js` (re-exported from `lib/spec-store/spec-key.js` for store callers). |
| **Events** | Append-only lifecycle log (`events.jsonl`). Source of truth for workflow semantics. |
| **Snapshot** | Derived point-in-time projection (`snapshot.json`). Disposable cache of projector output. |
| **Leases** | Future cross-machine coordination primitive (not implemented in 573). |
| **Indexes** | Future read-optimised lookups (dashboard spec index today; SpecStore indexes later). |
| **Projections** | Human-facing artefacts derived from durable state — spec markdown files and folder placement. |

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

**SpecStore** owns the durable storage protocol — how events, snapshots, locks, and spec bodies are read and written.

**workflow-core** owns lifecycle semantics — which transitions are valid, what events mean, and how snapshots are projected.

**Spec files** (`docs/specs/features/`, `docs/specs/research-topics/`) remain human/agent-facing projections. They are not the authority for lifecycle state.

**Folders** (`01-inbox` … `06-paused`) are derived from lifecycle for UX. Folder position must not be treated as the sole source of truth when an engine snapshot exists.

## SpecStore interface (feature 573)

Module: `lib/spec-store/`. Factory: `createSpecStore({ repoPath, backend?: 'local' })`.

| Method | Role | Delegates to (local backend) |
|--------|------|------------------------------|
| `listSpecs()` | Enumerate numbered specs visible under `docs/specs/` | `lib/workflow-core/paths.js` stage dirs |
| `readSpec(key)` | Read spec markdown body | `paths.js` `getSpecPathForEntity` |
| `readEvents(key)` | Read append-only event log | `event-store.js` via entity ref |
| `readEventsSync(ref)` | Sync event read (dashboard hot paths) | `local-backend.js` |
| `appendEvent(key, event)` | Append one event | `event-store.js` |
| `readSnapshot(key)` | Read derived snapshot | `snapshot-store.js` |
| `readSnapshotSync(ref)` | Sync snapshot read (dashboard hot paths) | `local-backend.js` |
| `writeSnapshot(key, snapshot)` | Write derived snapshot | `snapshot-store.js` |
| `lock(key, work, options?)` | Exclusive critical section (`try`, `retry: false`) | `lock.js` |
| `sync()` | Backend sync hook (stub in 573) | Returns `{ ok: true, backend: 'local' }` |
| `health()` | Backend health probe (stub in 573) | Returns `{ ok: true, backend: 'local' }` |

Feature 576 routes engine persistence and dashboard sync reads through the local backend; non-engine callers use `lib/workflow-core/persistence-compat.js`.

## Spec keys

- **Format:** `<KindLetter><Number>` where kind letter is `F` (feature) or `R` (research).
- **Examples:** `F42`, `R7`, `R100`.
- **Malformed keys** (`X1`, `F`, empty string) throw `SpecKeyError` — no silent coercion.

Identity helpers for `{ key, number, kind, slug }` land in feature 575. SpecStore keys address numbered specs; slug-keyed inbox entities remain workflow ids until prioritise assigns a number.

## Git-ref backend (future)

Not implemented in 573. Open question for the set:

| Option | Path pattern | Trade-off |
|--------|--------------|-----------|
| **Key-addressed (recommended)** | `refs/aigon/specs/F42/meta`, `refs/aigon/specs/F42/events`, … | Aligns with `F42`/`R43` keys; stable across renames; matches dashboard mental model. |
| **UUID-addressed** | `refs/aigon/specs/<uuid>/meta` | Indifferent to renumbering; requires a durable UUID index and more indirection for operators. |

**Recommendation:** prefer **key-addressed** refs (`refs/aigon/specs/<key>/…`) for the first Git-ref backend. Renumbering is rare and already a coordinated migration; key-addressed paths keep CLI, dashboard, and Git artefacts aligned. If cross-repo identity without renumbering becomes a hard requirement, add a secondary UUID index without making UUID the primary ref path.

## Related features

| Feature | Scope |
|---------|-------|
| 573 | This document + `lib/spec-store/` skeleton |
| 574 | Deprecate feedback into research origins |
| 575 | Repo-wide spec identity keys |
| 576 | Route workflow-core persistence through local SpecStore |
| 577 | Git-ref SpecStore backend |
| 578 | Sync, leases, reporting |

## Reading order

1. This document — storage boundary and layering
2. [`docs/architecture.md`](architecture.md) — full codebase map (workflow-core, dashboard read models)
3. `lib/spec-store/index.js` — module entry and factory
