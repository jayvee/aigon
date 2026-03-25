# Implementation Log: Feature 145 - metrics-feature-delivery
Agent: cx

## Plan
- Add a reusable commit analytics extractor in `lib/git.js`:
  - Parse `git log --all --numstat`
  - Attribute commits to feature IDs and agents where possible
  - Cache parsed data under `.aigon/cache/commits.json`
- Expose commit analytics through:
  - `aigon commits` CLI command
  - Dashboard API endpoint `GET /api/commits`
- Extend dashboard Reports view with commit analytics:
  - Commits-over-time chart with daily/weekly/monthly toggle + date navigation
  - Commit table with sorting and filters (feature, agent, unattributed)
  - Feature list enrichment with commit count and total changed lines

## Progress
- Added commit analytics pipeline in `lib/git.js`:
  - `getCommitAnalytics()`, `filterCommitAnalytics()`, `buildCommitAnalyticsSummary()`, `buildCommitSeries()`
  - Feature attribution from branch refs and merge message references
  - Agent attribution from branch naming and Co-authored-by trailer token matching
  - Cache read/write at `.aigon/cache/commits.json` with `lastParsedCommit` marker
  - Increased git read buffer to handle large repositories
- Added `aigon commits` in `lib/commands/misc.js`:
  - Supports `--feature`, `--agent`, `--period`, `--limit`, `--refresh`
  - Prints summary and tabular recent commit output
- Added dashboard API route in `lib/dashboard-server.js`:
  - `GET /api/commits` with filters (`from`, `to`, `feature`, `agent`, `period`, `repo`, `limit`, `force=1`)
  - Response shape includes `commits`, `summary`, and `series` (daily/weekly/monthly)
- Updated dashboard Reports UI:
  - `templates/dashboard/js/statistics.js`: commit state, loading, chart series/window/panning/filter helpers
  - `templates/dashboard/js/logs.js`: commit cards, commit chart, feature/agent filters incl. unattributed, sortable commit table
  - Feature list now includes per-feature `Commits` and `Δ Lines` columns
  - `templates/dashboard/styles.css`: styling for commit table and feature-list alignment updates
- Added command/help surface updates:
  - `templates/help.txt` now documents `aigon commits`
  - `lib/templates.js` command registry includes `commits` arg hints
- Added smoke-level test coverage:
  - `aigon-cli.test.js` now checks `createMiscCommands().commits` exists

## Decisions
- Implemented a single git analytics source in `lib/git.js` and reused it for both CLI and dashboard API to avoid duplicated parsing logic.
- Chose fast heuristics for attribution:
  - Primary: feature/agent from branch naming (`feature-<id>-<agent>-...`)
  - Secondary: feature from commit message branch references
  - Fallback: agent from `Co-authored-by` trailer token detection
- Kept commit cache local and non-blocking: cache read/write failures never fail the command/API.
