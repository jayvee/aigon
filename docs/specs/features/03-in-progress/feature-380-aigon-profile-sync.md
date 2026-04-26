---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-26T06:36:19.523Z", actor: "cli/feature-prioritise" }
---

# Feature: aigon-profile-sync (F380)

## Summary

Aigon state falls into two meaningful categories: global user settings (`~/.aigon/`) and per-project workflow state (`.aigon/`). The existing `aigon sync` covers project state. This feature adds `aigon settings` — backup/restore for the global user profile (`~/.aigon/config.json`, `~/.aigon/workflow-definitions/`) — so agent definitions, model assignments, and workflow presets survive machine loss and transfer to new machines.

**Architecture decisions made 2026-04-26:**
- Settings panel in the dashboard is a global view (no project in context), so only the settings backup lives there. Per-project sync has no home in this UI — it belongs in a project-contextual surface (see separate feature for one-global-backup-repo architecture).
- Suggested default repo name: `aigon-settings` (private GitHub repo).
- Branch: `aigon-settings` (parallel to `aigon-state` used by project sync).

## User Stories

- [ ] As a user setting up aigon on a new machine, I can run `aigon settings pull` to restore my agent definitions, model assignments, and workflow presets without reconfiguring from scratch.
- [ ] As a user with two machines, I can back up settings changes on one and restore them on the other with a single command each.
- [ ] As a user, I can configure the backup remote, trigger back up, and restore directly from the dashboard Settings → Backup & Sync panel without opening a terminal.

## Acceptance Criteria

- [ ] `aigon settings configure <git-url>` — writes `sync.settingsRemote` into `~/.aigon/config.json`; creates `~/.aigon/.syncignore` with sensible defaults if absent.
- [ ] `aigon settings push` — commits `config.json` + `workflow-definitions/` from `~/.aigon/` to branch `aigon-settings` on the configured remote; records `lastPushAt` in `~/.aigon/.sync/sync-meta.json`.
- [ ] `aigon settings pull` — fetches and fast-forward merges from `aigon-settings` branch; copies files into `~/.aigon/`; records `lastPullAt`.
- [ ] `aigon settings status` — prints configured remote, last push/pull timestamps, and local-vs-remote divergence.
- [ ] Default syncignore excludes: `logs/`, `backups/`, `*.log`, `*.log.*`, `ports.json`, `action-logs.jsonl`, `conductor.pid`, `radar.log`, `dashboard.log*`, `.sync/`, `worktrees/`, `instances/`, `tmp/`, `sync/`.
- [ ] `aigon settings` subcommands are registered in `aigon-cli.js` under the `infra` domain alongside `aigon sync`.
- [ ] `GET /api/settings-sync/status` dashboard route returns `{ configured, remote, lastPushAt, lastPullAt }` from local metadata only (no git fetch). Stub already exists; replace it with the real implementation.
- [ ] Dashboard Settings → Backup & Sync panel shows "Your settings" with inline URL input, Back up / Restore / Status buttons, and last-synced timestamps. (Panel already exists in the dashboard with a stub; wire it up.)
- [ ] `aigon doctor` notes if settings backup is unconfigured (info-level, not error).
- [ ] Implementation reuses `sync-state.js` helpers — extract shared logic into `lib/sync-core.js` to avoid duplication.

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

The `aigon settings` CLI entry lives in `lib/commands/infra.js` alongside `aigon sync`, calling `lib/profile-state.js` (new file, mirrors `lib/sync-state.js` structure).

Dashboard route `GET /api/profile/status` reads `~/.aigon/.sync/sync-meta.json` and `~/.aigon/config.json` locally (no network call). Push/Pull open a terminal via the existing `/api/open-terminal` pattern.

## Dependencies

- Depends on F359 (aigon-state-sync) being complete — it is.

## Out of Scope

- Syncing `~/.claude/` — that's Claude Code's own data.
- Conflict resolution UI — CLI error messages with git instructions are sufficient.
- Automatic push on config change — explicit push only.
- Encrypting secrets in the synced config — out of scope; user is responsible for using a private remote.

## Open Questions

- Should `aigon sync push` and `aigon settings push` be combinable into `aigon sync push --all`? Defer — keep separate for now, add `--all` later if users ask.

## Related

- Prior feature: F359 (aigon-state-sync) — the project-level sync this extends
- Dashboard sync panel added in conversation 2026-04-26 (push/pull buttons in Settings)
