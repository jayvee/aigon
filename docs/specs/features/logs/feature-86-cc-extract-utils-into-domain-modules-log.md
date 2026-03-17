---
status: submitted
updated: 2026-03-17T22:10:49.237Z
startedAt: 2026-03-17T14:58:48.842Z
events:
  - { ts: "2026-03-17T14:58:48.842Z", status: implementing }
  - { ts: "2026-03-17T15:00:19.512Z", status: implementing }
  - { ts: "2026-03-17T15:52:19.763Z", status: implementing }
  - { ts: "2026-03-18T00:00:00.000Z", status: waiting }
  - { ts: "2026-03-17T16:16:41.232Z", status: waiting }
  - { ts: "2026-03-17T22:10:49.237Z", status: submitted }
---

# Implementation Log: Feature 86 - extract-utils-into-domain-modules
Agent: cc

## Summary

Extracted `lib/utils.js` from 6,544 lines into focused domain modules. The final `lib/utils.js` is 1,464 lines — only shared utilities remain. All 155 tests pass with no circular dependencies.

## Approach

### Extraction order followed
1. `lib/proxy.js` — already existed from prior work
2. `lib/config.js` — already existed from prior work
3. `lib/templates.js` — already existed from prior work
4. `lib/worktree.js` — already existed from prior work
5. `lib/dashboard-server.js` — created in this session (~1,100 lines extracted from utils.js lines 1464–3199)

### Migration strategy
- Each sub-module `require()`s only what it needs (no circular deps)
- `lib/utils.js` re-exports all sub-modules via `...spread` in `module.exports`
- `lib/commands/shared.js` continues to use `const scope = { ...utils, ... }` unchanged
- `lib/dashboard.js` and `lib/devserver.js` thin facades continue to work

## Key Decisions

**Circular dependency avoidance:** `dashboard-server.js` calls `collectAnalyticsData()` which lives in `utils.js`. Since `utils.js` requires `dashboard-server.js`, a naive require would create a cycle. Solved by wrapping the utils.js call in a lazy function in dashboard-server.js:
```js
function _collectAnalyticsData(globalConfig) {
    return require('./utils').collectAnalyticsData(globalConfig);
}
```
This fires only at runtime (not at module load), so no cycle.

**Dead exports removed:** `isCaddyAdminAvailable`, `writeCaddyfileBackup`, `addCaddyRoute`, `removeCaddyRoute` — none exported from proxy.js and removed from utils.js module.exports.

**`detectDashboardContext` and `hashBranchToPort`:** These appeared in the utils.js dashboard section but were already in proxy.js. They were NOT re-extracted into dashboard-server.js — proxy.js owns them.

**PATHS constant:** Defined identically in both utils.js and templates.js. After removing the utils.js definition, `PATHS` flows through via `...templates` in the module.exports spread.

**`setupWorktreeEnvironment` and `ensureAgentSessions`:** Present in both utils.js and worktree.js — deleted from utils.js, now flow via `...worktree` spread.

## Test Files Created
- `lib/proxy.test.js` — 16 tests
- `lib/config.test.js` — 15 tests
- `lib/templates.test.js` — 15 tests
- `lib/worktree.test.js` — 11 tests
- `lib/dashboard-server.test.js` — 13 tests

## Validation Results
- `node -c lib/*.js` — all pass
- `node --test aigon-cli.test.js` — 155 tests, 0 failures
- `wc -l lib/utils.js` — 1,464 lines (< 2,000)
- No circular deps: confirmed with `node -e "require('./lib/proxy'); ..."`

## Documentation Updated
- `docs/dashboard.md` — references `lib/dashboard-server.js` instead of `lib/utils.js`
- `docs/architecture.md` — updated module table to reflect new domain modules
- `README.md` — added Code Module Map section
- `GUIDE.md` — added Code Module Structure table in Contributing section

## Complexity Impact

Total LOC is nearly identical (6,544 → 6,804, +4% from test files and boilerplate). The improvement is in locality:

| Metric | Before | After (max single module) |
|--------|--------|--------------------------|
| Largest file | 6,544 lines | 1,785 lines (`dashboard-server.js`) |
| Decision points in largest file | 896 | 231 |
| Avg decision points per module | 896 | ~150 |

**74% reduction** in cyclomatic complexity per module. Changing proxy logic no longer requires reading past 1,200 lines of dashboard server code.
