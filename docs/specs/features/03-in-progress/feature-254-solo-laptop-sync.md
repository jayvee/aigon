# Feature: solo-laptop-sync — staged git-backed .aigon state sync for solo devs

## Summary

Add `aigon sync` commands that let a solo developer keep portable `.aigon/` state in sync across multiple machines via a private Git repo, with an explicit one-time bootstrap merge flow for the real migration case:

- laptop A has months of historical `.aigon` state
- laptop B is where the new sync feature is built first
- laptop A must pull the new aigon version before it can participate
- the first canonical sync baseline is created by exporting from A and merging on B

After that bootstrap, the normal workflow is strictly sequential:

- finish work on laptop A, `aigon sync push`
- switch to laptop B, `aigon sync pull`

This is a solo capability, not a teams or Pro feature.

## User Stories

- [ ] As a solo dev with two laptops, I want to recover from a split-brain period where laptop A has long-running Aigon history and laptop B has newer local changes, without losing either side's portable state
- [ ] As a solo dev building the sync feature on laptop B, I want laptop A to upgrade first, export its history, and then let laptop B create the first canonical merged baseline
- [ ] As a solo dev after bootstrap, I want a simple `push` / `pull` workflow to keep workflow history, telemetry, and reporting aligned across laptops
- [ ] As a solo dev, I want `aigon stats` and dashboard/reporting to reflect the same merged portable history regardless of which laptop I'm on
- [ ] As a solo dev, I want clear refusal when local aigon is too old to read or write the synced state

## Acceptance Criteria

- [ ] `aigon sync init <git-url>` initializes or clones a private sync repo and stores sync settings in `~/.aigon/config.json`
- [ ] `aigon sync export [--output <file>]` writes a portable state bundle for all registered local repos
- [ ] `aigon sync bootstrap-merge <bundle-file>` merges imported portable state with current local portable state on the receiving machine and writes the merged result locally
- [ ] `aigon sync bootstrap-merge <bundle-file> --push` also seeds the sync repo with the merged baseline and records bootstrap metadata
- [ ] `aigon sync push` copies portable state for registered repos into the sync repo, commits, and pushes
- [ ] `aigon sync pull` pulls the sync repo and restores portable state into each registered local repo, then clears disposable caches
- [ ] `aigon sync status` shows whether sync is initialized, whether bootstrap has been completed, last push/pull time, registered repos, and pending changes
- [ ] Bootstrap flow explicitly supports this rollout order:
  1. implement sync feature on laptop B
  2. commit/push aigon from B
  3. pull latest aigon onto laptop A
  4. run `aigon sync export` on A
  5. run `aigon sync bootstrap-merge` on B
  6. use regular `push` / `pull` from then on
- [ ] Portable workflow history and telemetry from both laptops survive the bootstrap merge
- [ ] Derived files are rebuilt from authoritative data after bootstrap and pull
- [ ] Pull refuses with a clear upgrade message when the local aigon version is older than the minimum supported version written by the sync metadata
- [ ] Non-fast-forward regular `push` / `pull` does not silently auto-merge workflow authority files; the command stops with a clear message

## Validation

```bash
node --check aigon-cli.js
npm test
```

## Technical Approach

### Mental model

This feature has two operating modes:

1. **Bootstrap recovery mode**
   One-time import + merge for users who already have divergent portable state on two laptops.

2. **Steady-state sync mode**
   Sequential solo use after bootstrap: one active laptop at a time, manual `push` / `pull`.

The design must optimize for correctness of portable state, not for automatic conflict resolution of arbitrary concurrent edits.

### Sync repo structure

```
aigon-sync/
├── repos/
│   ├── github.com-jayvee-aigon/
│   │   └── .aigon/
│   │       ├── workflows/
│   │       ├── state/
│   │       ├── telemetry/
│   │       └── config.json
│   ├── github.com-jayvee-brewboard/
│   │   └── .aigon/
│   │       └── ...
│   └── ...
├── metadata/
│   ├── manifest.json
│   └── bootstrap.json
└── README.md
```

Notes:

- Repo directories are keyed by a stable repo ID, not by basename alone
- Recommended repo ID: normalized git origin URL; fallback to hashed canonical path if no remote exists
- The sync repo stores only portable Aigon state, not source code repos

### Commands

```bash
# One-time setup
aigon sync init git@github.com:user/aigon-sync.git

# Register repos to participate in sync
aigon sync register
aigon sync register ~/src/brewboard

# One-time recovery/bootstrap flow
# Laptop A: after upgrading to the new aigon version
aigon sync export --output ~/Desktop/aigon-sync-A.tgz

# Laptop B: after pulling latest code repos
aigon sync bootstrap-merge ~/Desktop/aigon-sync-A.tgz
aigon sync bootstrap-merge ~/Desktop/aigon-sync-A.tgz --push

# Regular usage after bootstrap
aigon sync push
aigon sync pull
aigon sync status
```

### What syncs

Portable state:

| Source | Sync? | Why |
|--------|-------|-----|
| `.aigon/workflows/` | Yes | Authoritative feature/research workflow event logs plus derived stats |
| `.aigon/telemetry/` | Yes | Normalized session telemetry used by analytics/reporting |
| `.aigon/state/` | Yes, selectively | Some files still inform analytics and dashboard continuity |
| `.aigon/config.json` | Yes | Per-repo Aigon preferences |
| `~/.aigon/config.json` | Partially | Sync settings and explicitly shared sync metadata only |

Never sync:

| Source | Sync? | Why |
|--------|-------|-----|
| `.aigon/cache/` | No | Disposable; rebuild after restore |
| `.aigon/locks/` | No | Ephemeral |
| `.aigon/workflows/**/lock` | No | Ephemeral workflow lock |
| `~/.aigon/worktrees/` | No | Machine-specific paths |
| `~/.aigon/dev-proxy/` | No | Machine-specific process/Caddy state |
| `~/.aigon/ports.json` | No | Machine-specific port allocations |
| `~/.aigon/logs/` | No | Machine-local logs |

### `.aigon/state/` policy

Do not treat all of `.aigon/state/` as disposable.

Current Aigon code still reads repo-local state files for:

- winner attribution
- started/completed timestamps
- legacy event-derived analytics
- dashboard per-agent metadata/flags

So the policy is:

- include repo/entity manifest files such as `feature-*.json` and `research-*.json`
- include per-agent files only when they contain durable metadata worth preserving
- exclude obviously live runtime-only artifacts such as heartbeat/lock/temp files

If the implementation cannot reliably distinguish durable from ephemeral per-agent files in v1, prefer syncing `.aigon/state/` except known ephemeral patterns rather than excluding it entirely.

### Global config policy

Do not restore `~/.aigon/config.json` wholesale between machines.

Instead:

- store sync settings in a dedicated `sync` block under `~/.aigon/config.json`
- persist shared sync metadata in the sync repo under `metadata/manifest.json`
- merge only sync-related settings automatically
- leave machine-local settings such as terminal/editor/host-specific agent preferences untouched

### Version and format safety

The sync repo records:

- `syncSchemaVersion`
- `writtenByAigonVersion`
- `minReadableAigonVersion`
- `bootstrappedAt`
- `bootstrappedByHost`

Version safety rule:

- if local aigon is older than `minReadableAigonVersion`, refuse with an upgrade-first message
- do not rely on "major.minor only" comparisons
- patch versions are not assumed universally safe

### Bootstrap merge strategy

Bootstrap merge is a one-time recovery operation, not the normal path.

Merge by data type, not by naive directory overlay:

- **telemetry JSON files**
  - merge by filename/content union
  - keep both sides unless the same file already exists with identical content

- **workflow event logs (`events.jsonl`)**
  - parse both sides as event streams
  - dedupe by full normalized event payload or stable event hash
  - never dedupe by `type+at`
  - write a merged event log
  - rebuild snapshots afterward

- **workflow snapshots (`snapshot.json`)**
  - never trusted as merge input
  - delete and rebuild from merged event logs

- **workflow stats (`stats.json`)**
  - treat as derived when rebuild support exists
  - if rebuild is not available in v1, keep the newer file as a temporary fallback and mark that behavior as best-effort

- **repo/entity state manifests in `.aigon/state/`**
  - merge conservatively
  - union embedded event arrays by full event identity
  - preserve winner/timestamp fields when present on either side
  - prefer the newer scalar value only when there is no safe structural merge

- **per-agent runtime files**
  - do not try to recreate live running state
  - preserve only durable metadata if useful
  - strip stale live/session-only fields where appropriate

- **caches/locks/heartbeats**
  - discard always

### Steady-state push/pull strategy

After bootstrap, regular `push` / `pull` assumes sequential solo use:

- one active laptop at a time
- work completed before switching
- no live tmux sessions or in-progress Aigon mutations during sync

Regular sync behavior:

- `push`
  - verify sync repo exists
  - verify clean preconditions
  - copy portable state into sync repo
  - commit and push

- `pull`
  - pull sync repo
  - verify compatibility/version
  - restore portable state into local repos
  - clear `.aigon/cache/`
  - rebuild derived state where supported

Regular sync should **not** auto-resolve diverged workflow authority files. If the sync repo and local source are not on the expected linear path, stop and direct the user to resolve manually or re-run an explicit recovery command.

### Repo registration and identity

`aigon sync register [repo-path]` records:

- stable repo ID
- display name
- local path on this machine
- origin URL if available
- registered timestamp

The sync repo manifest stores repo identity separately from machine-local paths so two laptops with different checkout locations can sync the same repo safely.

### Metadata files

`metadata/manifest.json`:

```json
{
  "syncSchemaVersion": 1,
  "repos": {
    "github.com-jayvee-aigon": {
      "displayName": "aigon",
      "originUrl": "git@github.com:jayvee/aigon.git",
      "registeredAt": "2026-04-13T00:00:00Z"
    }
  },
  "machines": {
    "Laptop-A": {
      "lastExportAt": "2026-04-13T00:00:00Z",
      "lastPushAt": "2026-04-20T00:00:00Z"
    },
    "Laptop-B": {
      "lastBootstrapMergeAt": "2026-04-15T00:00:00Z",
      "lastPullAt": "2026-04-21T00:00:00Z"
    }
  }
}
```

`metadata/bootstrap.json`:

```json
{
  "syncSchemaVersion": 1,
  "bootstrapped": true,
  "bootstrappedAt": "2026-04-15T00:00:00Z",
  "bootstrappedByHost": "Laptop-B",
  "sources": [
    {
      "kind": "import-bundle",
      "host": "Laptop-A",
      "writtenByAigonVersion": "2.53.0"
    },
    {
      "kind": "local-state",
      "host": "Laptop-B",
      "writtenByAigonVersion": "2.53.0"
    }
  ],
  "minReadableAigonVersion": "2.53.0"
}
```

### Preflight checks

`export`, `bootstrap-merge`, `push`, and `pull` should run defensive checks:

- no active workflow lock files
- no in-progress tmux sessions for synced repos when the command requires quiescence
- sync repo exists and has a valid manifest for push/pull
- local repos referenced by registration exist before restore
- current aigon version satisfies minimum readable version

### Implementation location

- `lib/commands/infra.js`
  - add `sync-*` command handlers
- `lib/sync.js`
  - new module for sync repo management, bundle export/import, restore, preflight checks, metadata
- `lib/sync-merge.js`
  - new module for one-time bootstrap merge logic and data-type-specific merge rules

No dashboard UI changes are required for v1.

## Dependencies

- Private Git repo created by the user ahead of time
- `git` CLI available on both machines
- Credentials configured for the sync repo on both machines

Optional future enhancement:

- GitHub repo creation via `gh` CLI, but not required for v1

## Out of Scope

- Multi-user or team sync
- Real-time sync or file watching
- Syncing live tmux sessions, worktree directories, or dev-proxy processes
- Syncing raw conversation/transcript history from `~/.claude/`, `~/.gemini/`, or `~/.codex/`
- Generic automatic merge of arbitrary concurrent state divergence after bootstrap
- Dashboard controls for sync
- Pro feature gating

## Open Questions

- Should there be an explicit `aigon sync recover` command later for rare post-bootstrap divergence, distinct from `bootstrap-merge`?
- Should `stats.json` gain an explicit rebuild command so restore/bootstrap never needs "newer file wins" fallback behavior?
- Should `sync register` default to every repo in global config, or remain explicit per repo for safety?

## Related

- `lib/utils.js` analytics reads telemetry and still consults `.aigon/state/` for some feature metadata
- `lib/agent-status.js` and dashboard read paths still use `.aigon/state/`
- `lib/stats-aggregate.js` caches aggregate report data and should be cleared/rebuilt after restore
- `docs/architecture.md` documents workflow-core as event-sourced authority; bootstrap merge must respect that
