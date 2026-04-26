---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-26T06:36:19.523Z", actor: "cli/feature-prioritise" }
---

# Feature: aigon-profile-sync (F380)

## Summary

Aigon state lives in three buckets: project state (`.aigon/`), user profile (`~/.aigon/`), and ephemeral runtime. The existing `aigon sync` command covers project state only. This feature adds `aigon profile` — a parallel sync command for the global user profile (`~/.aigon/config.json` and `~/.aigon/workflow-definitions/`) — so that the full meaningful state can be moved between machines or restored after data loss. The dashboard Sync section is extended to show both project and profile sync scopes side by side.

## User Stories

- [ ] As a user setting up aigon on a new machine, I can run `aigon profile pull` to restore my agent definitions, model assignments, and named workflow presets without reconfiguring from scratch.
- [ ] As a user with two machines, I can push profile changes from one and pull them on the other with a single command each.
- [ ] As a user, I can see the status of both project and profile sync at a glance in the dashboard Settings → Sync panel.
- [ ] As a user, I can trigger profile push/pull from the dashboard without opening a terminal.

## Acceptance Criteria

- [ ] `aigon profile configure <git-url>` — writes `sync.profileRemote` into `~/.aigon/config.json`; creates `~/.aigon/.syncignore` with sensible defaults if absent.
- [ ] `aigon profile push` — commits `config.json` + `workflow-definitions/` from `~/.aigon/` to a dedicated `aigon-profile` branch on the configured remote; records `lastPushAt` in `~/.aigon/.sync/sync-meta.json`.
- [ ] `aigon profile pull` — fetches and fast-forward merges from `aigon-profile` branch; copies files into `~/.aigon/`; records `lastPullAt`.
- [ ] `aigon profile status` — prints configured remote, last push/pull timestamps, and local-vs-remote divergence (same shape as `aigon sync status`).
- [ ] Default profile syncignore excludes: `logs/`, `backups/`, `*.log`, `*.log.*`, `ports.json`, `action-logs.jsonl`, `conductor.pid`, `radar.log`, `dashboard.log*`, `.sync/`, `worktrees/`, `instances/`, `tmp/`, `sync/`.
- [ ] `aigon profile` subcommands are registered in `aigon-cli.js` under the `infra` domain alongside `aigon sync`.
- [ ] `GET /api/profile/status` dashboard route returns `{ configured, remote, lastPushAt, lastPullAt }` from local metadata (no git fetch, fast).
- [ ] Dashboard Settings → Sync section shows two panels: **Project** (existing) and **Profile** (new), each with Push / Pull / Status buttons and last-synced timestamp.
- [ ] `aigon doctor` notes if profile sync is unconfigured (info-level, not error).
- [ ] Implementation reuses `sync-state.js` helpers (helper repo pattern, syncignore matcher, meta read/write) — no duplication. Extract shared logic into a new `lib/sync-core.js` if needed.

## Validation

```bash
node --check lib/sync-state.js
node --check lib/commands/infra.js
node --check lib/dashboard-routes.js
npm test
```

## Pre-authorised

- May extract shared sync logic from `lib/sync-state.js` into `lib/sync-core.js` without a separate refactor feature.
- May raise `scripts/check-test-budget.sh` CEILING by up to +40 LOC if new unit tests require it.

## Technical Approach

The existing `lib/sync-state.js` implements the full push/pull/configure/status lifecycle using a hidden helper git repo (`.aigon/.sync/repo`) and a dedicated branch (`aigon-state`). The profile sync follows the same pattern:
- Helper repo at `~/.aigon/.sync/repo`
- Branch: `aigon-profile`
- Synced files: `config.json`, `workflow-definitions/**`
- Meta stored at `~/.aigon/.sync/sync-meta.json`

Shared logic (helper repo init, git wrapper, syncignore matcher, meta read/write) should be extracted into `lib/sync-core.js` so both project and profile sync use the same engine without duplication.

The `aigon profile` CLI entry lives in `lib/commands/infra.js` alongside `aigon sync`, calling `lib/profile-state.js` (new file, mirrors `lib/sync-state.js` structure).

Dashboard route `GET /api/profile/status` reads `~/.aigon/.sync/sync-meta.json` and `~/.aigon/config.json` locally (no network call). Push/Pull open a terminal via the existing `/api/open-terminal` pattern.

## Dependencies

- Depends on F359 (aigon-state-sync) being complete — it is.

## Out of Scope

- Syncing `~/.claude/` — that's Claude Code's own data.
- Conflict resolution UI — CLI error messages with git instructions are sufficient.
- Automatic push on config change — explicit push only.
- Encrypting secrets in the synced config — out of scope; user is responsible for using a private remote.

## Open Questions

- Should `aigon sync push` and `aigon profile push` be combinable into `aigon sync push --all`? Defer — keep separate for now, add `--all` later if users ask.

## Related

- Prior feature: F359 (aigon-state-sync) — the project-level sync this extends
- Dashboard sync panel added in conversation 2026-04-26 (push/pull buttons in Settings)
