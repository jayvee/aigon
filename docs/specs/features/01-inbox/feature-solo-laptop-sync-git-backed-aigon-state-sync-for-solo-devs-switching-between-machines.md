# Feature: solo-laptop-sync — git-backed .aigon state sync for solo devs

## Summary

Add `aigon sync` commands that let a solo developer keep `.aigon/` state (workflow history, telemetry, config) in sync across multiple machines via a private GitHub repo. Strictly sequential workflow: finish work on laptop A, `aigon sync push`, switch to laptop B, `aigon sync pull`. Covers all repos registered with aigon on the machine.

## User Stories

- [ ] As a solo dev with two laptops, I want to push my aigon state from laptop A so that when I switch to laptop B I have full workflow history, telemetry, and stats
- [ ] As a solo dev, I want `aigon stats` and `aigon board` to show the same data regardless of which laptop I'm on
- [ ] As a solo dev setting this up for the first time, I want to bootstrap from my primary laptop (which has all history) with a single push command
- [ ] As a solo dev, I want to be warned if my local aigon version is too old to read the synced state, rather than silently corrupting it

## Acceptance Criteria

- [ ] `aigon sync init <github-url>` — clones/creates private sync repo, stores path in `~/.aigon/config.json` under `sync.repoPath`
- [ ] `aigon sync register [repo-path]` — adds current (or specified) repo to `manifest.json` in the sync repo
- [ ] `aigon sync push` — for each registered repo found locally, copies portable state into the sync repo, commits, pushes
- [ ] `aigon sync pull` — pulls sync repo, restores state into each registered repo found locally, wipes `.aigon/cache/`
- [ ] `aigon sync status` — shows last push/pull time, which repos are registered, any pending changes
- [ ] Push records the aigon version that wrote the state. Pull refuses if local aigon version is older than the writing version (with clear "upgrade first" message)
- [ ] Telemetry files (unique session filenames) never conflict
- [ ] Workflow event logs (append-only JSONL) merge cleanly in sequential use
- [ ] First push from a machine with existing history (bootstrap) works identically to subsequent pushes — no special bootstrap command

## Validation

```bash
node --check aigon-cli.js
npm test
```

## Technical Approach

### Sync repo structure
```
aigon-sync/
├── repos/
│   ├── aigon/
│   │   ├── workflows/        # .aigon/workflows/
│   │   ├── telemetry/        # .aigon/telemetry/
│   │   └── config.json       # .aigon/config.json
│   ├── brewboard/
│   │   └── ...
│   └── trailhead/
│       └── ...
├── global/
│   └── config.json           # ~/.aigon/config.json
├── manifest.json             # registered repos + metadata
└── .aigon-sync-version       # aigon version that last wrote
```

### What syncs (portable state)

| Source | Sync? | Why |
|--------|-------|-----|
| `.aigon/workflows/` | Yes | Event logs, snapshots, stats — workflow history |
| `.aigon/telemetry/` | Yes | Session cost/token data — powers `aigon stats` |
| `.aigon/config.json` | Yes | Per-repo preferences |
| `~/.aigon/config.json` | Yes | Global preferences |
| `.aigon/state/` | No | Ephemeral session/heartbeat files |
| `.aigon/cache/` | No | Rebuilt lazily from synced data |
| `.aigon/locks/` | No | Ephemeral |
| `~/.aigon/worktrees/` | No | Machine-specific paths |
| `~/.aigon/dev-proxy/` | No | Machine-specific Caddy state |
| `~/.aigon/ports.json` | No | Machine-specific port allocations |

### Version safety

The sync repo records the aigon version in `.aigon-sync-version`. On pull:
- Local version >= sync version: proceed (aigon's migration framework handles forward compat)
- Local version < sync version: refuse with message like `"State was written by aigon 2.53.0 but you have 2.51.2. Run 'aigon update' first."`

Compare only major.minor — patch differences are always safe.

### Merge strategy

In strict sequential use (the design target), git fast-forwards and there are no conflicts. But for the defensive case where someone forgets to push:

- **telemetry/*.json** — unique timestamped filenames, git auto-merges
- **workflows/{id}/events.jsonl** — append-only; in conflict, concat both sides, sort by `at` timestamp, deduplicate by `type+at`
- **workflows/{id}/snapshot.json** — derived from events; take the one with later `updatedAt`
- **workflows/{id}/stats.json** — take the one with later `updatedAt`
- **config.json** — take the one with later mtime; warn user

### Implementation location

- `lib/commands/infra.js` — add `sync-*` command handlers (fits the infra domain)
- `lib/sync.js` — new module for sync logic (repo management, copy, version check)
- No dashboard or UI changes needed

### Commands

```bash
# One-time setup
aigon sync init git@github.com:user/aigon-sync.git
aigon sync register                    # registers current repo
aigon sync register ~/src/brewboard    # registers another repo

# Daily use
aigon sync push      # commit + push state for all registered local repos
aigon sync pull      # pull + restore state for all registered local repos
aigon sync status    # show sync state
```

### manifest.json

```json
{
  "repos": {
    "aigon": {
      "path": "/Users/jviner/src/aigon",
      "registeredAt": "2026-04-13T...",
      "lastSyncedAt": "2026-04-13T..."
    },
    "brewboard": {
      "path": "/Users/jviner/src/brewboard",
      "registeredAt": "2026-04-13T..."
    }
  },
  "machines": {
    "Johns-MacBook-Pro": {
      "lastPush": "2026-04-13T...",
      "aigonVersion": "2.51.2"
    }
  }
}
```

The `machines` block tracks which machine last pushed — useful for `sync status` to show "last pushed from Johns-MacBook-Pro 2 hours ago".

## Dependencies

- Private GitHub repo (user creates this themselves)
- `git` CLI available on both machines
- SSH keys or HTTPS credentials configured for the sync repo on both machines

## Out of Scope

- Multi-user / team sync (this is solo-dev only)
- Real-time sync or file-watching
- Syncing conversation history (`~/.claude/`, `~/.gemini/`)
- Syncing worktree paths or tmux sessions
- Conflict resolution UI — warn and stop, user resolves manually
- Pro feature — this is core/free
- Auto-push/pull hooks (user runs manually)

## Open Questions

- Should `aigon sync push` be suggested automatically at feature-close? (Probably not for v1 — keep it manual)
- Should the sync repo path be configurable per-machine in manifest.json? (Yes — different users have different checkout paths. The repo *name* is the key, not the path.)

## Related

- `lib/migration.js` — existing tar-based backup/restore pattern (inspiration for defensive approach)
- `lib/stats-aggregate.js` — cache rebuild that runs automatically after pull
