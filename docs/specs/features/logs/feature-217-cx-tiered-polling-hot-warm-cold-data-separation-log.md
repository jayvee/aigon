# Implementation Log: Feature 217 - tiered-polling-hot-warm-cold-data-separation
Agent: cx

## Plan
- Add a per-repo tier cache in `lib/dashboard-status-collector.js` for hot/warm/cold data.
- Keep hot data (`in-progress`, `in-evaluation`, agent/tmux/liveness) on full 10s polling.
- Cache warm dirs (`01-inbox`, `02-backlog`, `06-paused`) behind directory mtime checks.
- Cache cold done dirs (features/research/feedback) behind directory mtime checks.
- Preserve response shape and existing dashboard behaviour.

## Progress
- Added module-level `_tierCache` map keyed by resolved repo path.
- Added `safeStat()` helper and `getTierCache()` initializer.
- Replaced per-poll done-file scanning in features with cached cold-tier reads invalidated by `05-done` dir mtime.
- Applied the same cold-tier cache invalidation for research `05-done` and feedback `04-done`.
- Applied warm-tier cache invalidation for feature inbox/backlog/paused directories.
- Added `clearTierCache(repoPath)` export for explicit cache clearing support.
- Ran syntax validation:
  - `node -c lib/dashboard-status-collector.js`
  - `node -c lib/dashboard-server.js`
- Restarted backend with `aigon server restart` and then stopped via `aigon server stop` after validation.

## Decisions
- Cache keys use absolute repo path to keep caches isolated in multi-repo conductor setups.
- Cold tier stores full done metadata (`total`, `all`, `recent`) so `doneTotal` and recent-done behavior remain unchanged.
- Warm tier only caches lower-churn directories to avoid touching hot-path agent/session status behavior.
- `clearTierCache` supports both targeted clear (`repoPath`) and full clear (no arg).
