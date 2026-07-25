---
commit_count: 6
lines_added: 12472
lines_removed: 4618
lines_changed: 17090
files_touched: 259
fix_commit_count: 1
fix_commit_ratio: 0.167
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: true
input_tokens: 355
output_tokens: 262036
cache_creation_input_tokens: 762388
cache_read_input_tokens: 56893671
thinking_tokens: 0
total_tokens: 57918450
billable_tokens: 262391
cost_usd: 119.2933
sessions: 1
model: "claude-opus-4-7"
tokens_per_line_changed: null
---
# Implementation Log: Feature 236 - move-backup-sync-and-scheduling-to-pro
Agent: cc

## Status

Implemented in two coordinated commits — one in OSS aigon, one in aigon-pro.
OSS commit moves engines out, reduces CLI verbs to delegating stubs, adds two
new top-level dashboard tabs (`Backup & Sync (PRO)`, `Scheduled Features
(PRO)`) with empty target divs, deletes the six moved feature specs/logs and
the ten recurring templates, and trims doctor/onboarding-wizard touchpoints.
aigon-pro commit receives the lib engines, the moved specs/logs, the
recurring templates, the CLI command files (rewritten to import OSS internals
via `aigon/lib/...`), and a new `register(api)` body that wires routes for
`/api/backup/*`, `/api/sync/status`, `/api/profile/status`,
`/api/settings-sync/status`, `/api/schedule/{jobs,add,cancel}` plus three
background pollers (recurring spawner every 24 h, scheduled-kickoff every
45 s, vault push hourly).

## New API Surface

- OSS `lib/pro-bridge.js` `proBridge.initialize({ helpers })` gains four new
  helpers — `log`, `defaultRepoPath`, `cliEntryPath`, `emitNotification` —
  consumed by Pro's three pollers in `aigon-pro/index.js#register(api)`. All
  four are additive; older Pro builds that ignore them keep working.
- aigon-pro `index.js` exports gain `{ sync, vault, backup, recurring,
  scheduledKickoff, profile }` so OSS verb stubs can call
  `getPro().<module>.<fn>` directly.

## Key Decisions

- **Shim the OSS lib internals into aigon-pro/lib/.** The moved engines have
  deep deps on OSS infrastructure (`config`, `cli-parse`, `spec-crud`,
  `agent-registry`, `feature-spec-resolver`, `workflow-snapshot-adapter`,
  `feature-autonomous-payload`, `workflow-core/engine`). Rather than rewrite
  ~30 require lines across 10 files, each missing module is shimmed inside
  aigon-pro/lib as a one-line `module.exports = require('aigon/lib/<name>');`
  re-export. The host install of OSS aigon is reachable as `aigon` because
  aigon-pro/package.json declares it as a `file:../aigon` dep.
- **Rewrite cross-package version reference.**
  `lib/sync.js` previously did `require('../package.json').version`. After the
  move that resolves to aigon-pro's package.json (0.1.0). Pinned to
  `require('aigon/package.json').version` so it still reflects the host CLI.
- **CLI verb stubs delegate via `getPro()`, not require('@aigon/pro/...').**
  `lib/commands/{recurring,schedule,agent-launch}.js` and the backup/sync/vault
  branches in `lib/commands/infra.js` follow the insights pattern from
  `lib/commands/misc.js`: `isProAvailable()` gate, then call into a method on
  the Pro export. Avoids hard-coupling OSS to the Pro package layout.
- **Free-tier fallbacks for OSS callers of moved code.** `lib/board.js`,
  `lib/feature-start.js`, and `lib/dashboard-status-collector.js` previously
  imported `isFeatureSuspended` and `buildPendingScheduleIndex` directly.
  Replaced each with a Pro-aware fallback: ask Pro if available, else return
  the empty value. Free-tier semantics: no sync ⇒ no suspension; no scheduler
  ⇒ no pending jobs.
- **Onboarding wizard `vault` step gates on Pro.** Without Pro, the step
  short-circuits to `skipped` with a friendly note; the rest of onboarding
  continues to `done`. Doctor's Backup section and the trailing profile-sync
  notice both behave the same — they only print when Pro is installed.
- **Tabs over inline panels.** The pre-move Settings tab had a Backup & Sync
  sub-section; the post-move dashboard surfaces it as its own top-level tab
  alongside `Scheduled Features`. Both tabs use the same empty-div +
  Pro-served-JS pattern as `Insights`. Without Pro, both tabs show the
  standard "Pro — coming later" placeholder so the user understands what they
  unlock.
- **`aigon security-scan` retained, `--install-recurring` dropped.** F368's
  manual scan stays in OSS as an on-demand CLI; the weekly cron wrapper
  belonged to the recurring engine that moved to Pro.

## Gotchas / Known Issues

- The pre-existing test failures in `tests/integration/submit-signal-loss.test.js`
  and `tests/integration/getNextId-worktree-aware.test.js` were already failing
  before this feature touched the tree; they are not regressions introduced
  by the move.
- Two compact JS guards inside `templates/dashboard/js/init.js` (`var _bsv =
  document.getElementById('backup-sync-view'); if (_bsv) _bsv.style.display =
  'none';`) keep older browsers happy without adding helper functions.
- Pro's dashboard JS files (`backup-sync.js`, `scheduled-features.js`) are
  not included in this move — Pro's existing `dashboardDir` mechanism plus
  the OSS init.js `if (typeof renderBackupSync === 'function')` guard means
  the OSS placeholder copy ships now and the rich UI lands when Pro adds
  those files. The scheduled-kickoff modal in `templates/dashboard/js/actions.js`
  still POSTs `/api/schedule/add`; without Pro that route returns 404 and the
  modal surfaces the error.

## Explicitly Deferred

- Extracting `renderSyncPanel`/`renderSyncPanels` into
  `aigon-pro/dashboard/backup-sync.js` and adding a
  `aigon-pro/dashboard/scheduled-features.js` listing `/api/schedule/jobs`.
  The OSS placeholder is sufficient for the OSS user story; the Pro UX port
  is a follow-up inside aigon-pro.
- Moving the schedule-kickoff modal logic out of `templates/dashboard/js/actions.js`.
  It is contextual (right-click on a feature/research card) rather than a
  top-level surface, so it can stay until Pro takes over its UX.

## For the Next Feature in This Set

- Build the two Pro dashboard JS files mentioned above so paid users see
  identical UX to the pre-move Settings panel.
- Smoke-test the Docker Linux fresh-install path per
  `feedback_test_as_new_user` once the Pro package is published — confirm
  the dashboard renders the two new tabs with PRO markers and the CLI verbs
  print the standard Pro notice.

## Test Coverage

- Adjusted `tests/integration/token-window.test.js` and
  `tests/integration/workflow-read-model.test.js` to drop assertions over
  `lib/scheduled-kickoff.js` (the engine moved). The token-window
  configuration coverage and the read-model dashboard-state coverage stay.
- Deleted `tests/integration/{recurring-instance-body-week-placeholder,
  scheduler-agent-prompt,sync-state}.test.js` — they exercised engines that
  no longer live in OSS. Those regression tests should land in aigon-pro
  alongside the engines.
- `node -c aigon-cli.js` succeeds; `npm run lint` is clean;
  `AIGON_FORCE_PRO=0 ./aigon-cli.js sync --help` prints the expected
  "Pro feature" notice; `grep -rln "agent_prompt" lib/` only matches the
  comments left to explain the move; `docs/specs/recurring/` is gone.

## Code Review

**Reviewed by**: aigon-feature-code-review
**Date**: 2026-04-27

### Fixes Applied
- `b710190` fix(review): poll recurring features for all registered repos and escape homedir replace

### Residual Issues
- None

### Notes
- Clean review overall, identified a minor displayPath bug and an issue with recurring check polling only the default repo.
