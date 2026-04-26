---
complexity: high
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-26T06:36:19.523Z", actor: "cli/feature-prioritise" }
---

# Feature: aigon-vault — unified backup & sync (F380)

> Supersedes the earlier "aigon-profile-sync" framing. Replaces `aigon sync` (F359).

## Summary

Aigon has two categories of state that must survive machine loss and transfer across machines:

1. **Project state** — specs, workflow snapshots, board layout, and project-level config for each repo managed by aigon (lives in `.aigon/` inside each project, gitignored)
2. **Global settings** — agent definitions, model assignments, workflow preset definitions, security and recovery config (lives in `~/.aigon/`, never in any project repo)

Today `aigon sync` covers project state only, via a per-project git branch. This feature replaces it entirely with `aigon backup` — a single command that backs up both categories into one private git repository called `aigon-vault`, with a clear directory structure. A daily scheduled push runs automatically via the aigon server; on-demand push/pull is always available from the CLI and the dashboard.

## User Stories

- [ ] As a user whose laptop is destroyed, I can set up aigon on a new machine, run `aigon backup pull`, and be working again within minutes — all my projects, settings, and workflow presets restored.
- [ ] As a user with two machines, I can push from machine A and pull on machine B to keep both in sync.
- [ ] As a user, I never have to think about backing up — the aigon server does a daily push automatically.
- [ ] As a user setting up for the first time, the CLI offers to create the `aigon-vault` private repo on GitHub for me, suggests the name, and configures everything in one step.
- [ ] As a user, I can see backup status, trigger a manual back up, and change the schedule directly from the dashboard Settings → Backup & Sync panel.

## The aigon-vault repo structure

One private git repository, `aigon-vault`, with two top-level directories:

```
aigon-vault/
├── projects/
│   ├── aigon/
│   │   ├── state/           ← .aigon/state/
│   │   ├── workflows/       ← .aigon/workflows/
│   │   ├── migrations/      ← .aigon/migrations/
│   │   └── config.json      ← .aigon/config.json
│   ├── my-other-app/
│   │   └── ...
│   └── another-project/
│       └── ...
└── settings/
    ├── config.json          ← ~/.aigon/config.json (repos and serverPort stripped)
    └── workflow-definitions/
        ├── cheap-test.json
        └── solo-cc-sonnet-reviewed-cx-gpt54.json
```

**What is excluded from `settings/config.json`:**
- `repos` — absolute paths, machine-specific; rebuilt on restore via auto-discovery
- `serverPort` — machine-specific; always uses the standard default
- `sync` — old sync metadata; replaced by this system

Everything else in `~/.aigon/config.json` is included: agent definitions (including `cli` fields — these are command names, not machine-specific paths), model assignments, flags, security config, recovery and failover policy, token window config.

**What is excluded from `projects/{name}/`:**
- `.aigon/sessions/` — live tmux session metadata
- `.aigon/locks/` — process locks
- `.aigon/telemetry/` — usage telemetry
- `.aigon/budget-cache.json`, `insights-cache.json` — caches
- `.aigon/cache/` — caches
- `.aigon/server/` — dashboard server state
- `.aigon/recurring-state.json` — scheduler run state

## Acceptance Criteria

### CLI — `aigon backup`

- [ ] `aigon backup configure` — interactive setup: detects if `gh` CLI is available and offers to create the `aigon-vault` private repo on GitHub; suggests `aigon-vault` as the default name; accepts a custom git URL; writes the remote into `~/.aigon/config.json` as `backup.remote`; initialises the helper repo; prints confirmation.
- [ ] `aigon backup configure <git-url>` — non-interactive version; skips `gh` creation flow.
- [ ] `aigon backup push` — pulls from remote first (fails loudly if diverged rather than overwriting); commits project states for all registered repos + settings; pushes to remote; records `lastPushAt`.
- [ ] `aigon backup pull` — fetches and fast-forward merges; restores settings into `~/.aigon/`; for each project directory in `projects/`, attempts to locate the project on disk by scanning `~/src/`, `~/code/`, `~/Developer/`, and the current directory tree; auto-registers found projects; for projects not found, prints a clear list: "Project 'brewboard' not found — clone it and run `aigon server add <path>`"; records `lastPullAt`.
- [ ] `aigon backup status` — prints: configured remote, last push timestamp, last pull timestamp, number of projects in vault, whether a scheduled push is active and its cadence.
- [ ] `aigon backup schedule [daily|hourly|weekly|off]` — configures the auto-push cadence; default is `daily`; stored in `~/.aigon/config.json` as `backup.schedule`.
- [ ] `aigon sync` — kept as a deprecated alias for `aigon backup`; prints a deprecation notice directing users to `aigon backup`.
- [ ] `aigon backup configure` warns if the target path is inside an iCloud Drive or Dropbox folder, as combining git with cloud sync causes corruption.

### Scheduled push

- [ ] On server start, if `backup.remote` is configured and `backup.schedule` is not `off`, register a recurring job in the aigon scheduler.
- [ ] The scheduled job runs `aigon backup push` in the background; output is written to `~/.aigon/backup.log`.
- [ ] If push fails (e.g. diverged remote), the server emits a dashboard notification rather than silently failing.
- [ ] The schedule cadence is configurable per-user via `aigon backup schedule` or from the dashboard.

### Dashboard — Settings → Backup & Sync

- [ ] The existing "Your settings" panel (already in the dashboard with a stub) is wired up to the real `/api/settings-sync/status` endpoint.
- [ ] Panel shows: configured remote (editable inline), last backed up timestamp, last restored timestamp, schedule cadence selector (daily / hourly / weekly / off), Back up now button, Restore button, Status button.
- [ ] If not configured, shows the URL input field (already implemented) plus a "Create aigon-vault on GitHub" button that opens a terminal running `aigon backup configure`.
- [ ] `GET /api/backup/status` returns `{ configured, remote, lastPushAt, lastPullAt, schedule, projectCount }` from local metadata only (no network call).
- [ ] `POST /api/backup/schedule` accepts `{ cadence: 'daily'|'hourly'|'weekly'|'off' }` and updates the schedule.

### Doctor & onboarding

- [ ] `aigon doctor` notes if `backup.remote` is not configured (info-level, not error): "Backup not configured — run `aigon backup configure` to protect your aigon data."
- [ ] First-time `aigon init` (or `aigon doctor --fix`) suggests running `aigon backup configure` as a recommended next step.

## Technical Approach

### Replacing `aigon sync`

`lib/sync-state.js` implements the existing per-project sync using a hidden helper git repo (`.aigon/.sync/repo`) and a hardcoded `aigon-state` branch. This feature replaces that approach with a single helper repo pointing at `aigon-vault`, using a flat `main` branch and directories rather than branches per scope.

Recommended approach:
- Create `lib/backup.js` — the new engine (configure, push, pull, status, schedule)
- Keep `lib/sync-state.js` alive but have it delegate to `lib/backup.js` for backwards compatibility
- Register `aigon backup` subcommands in `lib/commands/infra.js` alongside `aigon sync` (which becomes an alias)

### Push algorithm

```
1. Pull from remote (fast-forward only; abort with clear error if diverged)
2. For each registered project repo:
   a. Copy .aigon/{state,workflows,migrations,config.json} → projects/{name}/
   b. Exclude sessions/, locks/, telemetry/, caches
3. Read ~/.aigon/config.json; strip repos, serverPort, sync keys
4. Write stripped config → settings/config.json
5. Copy ~/.aigon/workflow-definitions/ → settings/workflow-definitions/
6. git add -A && git commit -m "aigon backup — {timestamp}"
7. git push
8. Write lastPushAt to ~/.aigon/backup-meta.json
```

### Pull / restore algorithm

```
1. git pull (fast-forward)
2. Restore settings:
   a. Merge settings/config.json into ~/.aigon/config.json
      (preserve existing repos, serverPort; merge all other keys)
   b. Copy settings/workflow-definitions/ → ~/.aigon/workflow-definitions/
3. For each directory in projects/:
   a. Scan ~/src/, ~/code/, ~/Developer/, $PWD tree for a directory named {name}
      with a git repo inside
   b. If found: copy projects/{name}/ → .aigon/ inside that directory;
      run `aigon server add <path>` to register it
   c. If not found: add to "not found" list
4. Print summary: X projects restored, Y projects not found (with names and
   instructions to clone + run `aigon server add`)
5. Write lastPullAt to ~/.aigon/backup-meta.json
```

### Conflict handling

`aigon backup push` always pulls first. If the remote has diverged (non-fast-forward), it aborts with:
```
Remote has diverged from local. Pull first to integrate remote changes,
then retry: aigon backup pull && aigon backup push
```
It never force-pushes or silently overwrites.

### gh CLI integration

During `aigon backup configure` (interactive):
1. Check if `gh` is available and authenticated
2. If yes: "Create a new private GitHub repo? Suggested name: aigon-vault [Y/n]"
3. Run `gh repo create aigon-vault --private --description "aigon backup vault"`
4. Parse the returned URL; use as the remote
5. If `gh` not available or user declines: prompt for a git URL directly

## Validation

```bash
node --check lib/backup.js
node --check lib/commands/infra.js
node --check lib/dashboard-routes.js
npm test
```

## Pre-authorised

- May retire `lib/sync-state.js` push/pull logic in favour of `lib/backup.js`, keeping `sync-state.js` as a thin alias shim.
- May raise `scripts/check-test-budget.sh` CEILING by up to +60 LOC for new backup unit tests.
- May update `aigon help` and `templates/help.txt` to replace sync docs with backup docs without a separate feature.

## Out of Scope

- Encrypting vault contents — user is responsible for keeping the repo private.
- Conflict resolution UI — CLI error with instructions is sufficient.
- Syncing `~/.claude/` — Claude Code's own data, not aigon's to own.
- Team repo sharing — `aigon-vault` is personal; team workflows are a separate feature.
- Per-project vault overrides — one vault for all projects; team sharing designed separately.

## Dependencies

- F359 (aigon-state-sync) — superseded by this feature; `aigon sync` becomes a deprecated alias.

## Related

- Dashboard Backup & Sync panel: partially built in conversation 2026-04-26 (URL input, stub endpoint, Back up/Restore buttons in Settings → Backup & Sync)
- Research: git-as-backup pattern confirmed as established practice (chezmoi, YADM, Obsidian git plugin); daily scheduled push is the recommended cadence; git + iCloud/Dropbox must never be combined
