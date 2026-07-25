---
commit_count: 4
lines_added: 330
lines_removed: 61
lines_changed: 391
files_touched: 5
fix_commit_count: 0
fix_commit_ratio: 0
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 112
output_tokens: 26296
cache_creation_input_tokens: 140778
cache_read_input_tokens: 7407194
thinking_tokens: 0
total_tokens: 7574380
billable_tokens: 26408
cost_usd: 15.7243
sessions: 1
model: "claude-opus-4-6"
tokens_per_line_changed: null
---
# Implementation Log: Feature 219 - pro-extension-point-single-seam-for-aigon-pro-integration
Agent: cc

## Approach

Picked Option B (plugin route registration) per the spec's recommendation — smallest blast radius, addresses the next likely Pro feature (more dashboard routes), and the `/api/insights` migration is a clean proof point.

Created a new module `lib/pro-bridge.js` rather than extending `lib/pro.js`. Reasoning: `lib/pro.js` is intentionally a 25-line lazy-require gate; the bridge needs route registration, dispatch, helper plumbing, and (later) event-bus / anti-corruption layers. Keeping them separate preserves `lib/pro.js` as a one-line concept (is Pro available, give me the module) and lets `lib/pro-bridge.js` grow as the dedicated integration surface.

## Architecture

```
@aigon/pro                                  aigon (open-source)
───────────                                 ───────────────────
index.js exports register(api)
          │
          │  invoked once at startup
          ▼
                                            lib/pro-bridge.js
                                            ├─ initialize({ helpers })
                                            ├─ route registry (Map<method, Map<path, handler>>)
                                            └─ dispatchProRoute(method, path, req, res)
                                                            ▲
                                                            │ called per request
                                                            │
                                            lib/dashboard-server.js
                                            (no Pro knowledge except a single
                                             /api/insights* prefix check for
                                             the upgrade payload)
```

The bridge contract surface (`api`):

| Field | Purpose |
|---|---|
| `api.registerRoute(method, path, handler)` | Pro registers each endpoint |
| `api.helpers.loadProjectConfig` | Read project config (Pro insights uses cost caps) |
| `api.helpers.resolveRequestedRepoPath(raw)` | Sanitize a repo path against configured repos |
| `api.helpers.sendJson(res, status, payload)` | Standard JSON response helper |

Handlers receive `(req, res, ctx)` where `ctx` exposes `url` (parsed) and `readJsonBody()` (Promise). Pro never imports anything from aigon directly — every dependency comes through `api.helpers`.

## Key decisions

- **New file vs extending `lib/pro.js`**: kept `lib/pro.js` as the 25-line gate, put the extension surface in a separate `lib/pro-bridge.js`. The Module Map and `docs/architecture.md` now record the rule "exactly two files in aigon may import `@aigon/pro`".
- **Backward-compat fallback**: if `@aigon/pro` doesn't expose `register()` (older versions), the bridge wires the legacy `/api/insights` routes itself by reading `pro.insights` directly. This means a stale Pro install won't break the dashboard, and the bridge is still the only place where `getPro()` is touched for these routes. New Pro versions just override this with their own `register()`.
- **Pro-required fallback in dashboard-server.js**: kept a single `if (reqPath.startsWith('/api/insights'))` check that returns the upgrade payload when `isProAvailable() === false`. The dashboard server thus knows about exactly one Pro path *prefix*, not specific endpoints. Frontend rendering of upgrade UI keeps working unchanged.
- **Static asset routes for `/js/pro-reports.js` and `/js/amplification.js` left alone**: these are a different shape (static-asset proxy from `getPro().dashboardDir`), not API endpoint dispatch. The spec scope is the `/api/insights` API hook as the proof point; migrating static asset serving belongs to a follow-up if needed. Noted in spec comments.
- **Other `getPro()` call sites**: `lib/commands/misc.js` (`aigon insights` CLI) and `lib/dashboard-status-collector.js` (`proAvailable: isProAvailable()`) were reviewed. Neither benefits from migration today: the CLI command is a single self-contained handler, and the collector only reads the boolean availability flag. Both remain valid; the bridge will absorb them if/when their shape changes.
- **Helpers grow, never shrink**: documented in `architecture.md` that adding new helpers is backward-compatible but removing or changing existing helpers is a breaking change requiring coordinated bumps on both repos.

## Verification

- `node -c lib/pro.js` ✓
- `node -c lib/pro-bridge.js` ✓
- `node -c lib/dashboard-server.js` ✓
- `npm test` ✓ (all suites pass)
- Smoke test of the bridge dispatch in isolation with both `forcePro: true` and `forcePro: false` (stubbed config) ✓
- **Live `aigon server restart` with `forcePro: true`** → `GET /api/insights?repoPath=...` returns the full Pro insights JSON via the bridge-registered route ✓
- **Live `aigon server restart` with `forcePro: false`** → same endpoint returns `{"proRequired":true,"error":"AADE Insights requires @aigon/pro"}` ✓
- Restored `forcePro: true` after testing.

## Cross-repo changes

- `~/src/aigon-pro/index.js` — new `register(api)` export that calls `api.registerRoute('GET', '/api/insights', ...)` and `api.registerRoute('POST', '/api/insights/refresh', ...)`. Committed separately on `main` (`4b5f64e`).
- aigon side committed on the feature branch (`f7354892`).

## Notes for the reviewer

- The bridge's `legacy fallback` for older Pro versions is currently dead in this environment because `~/src/aigon-pro` was updated in lockstep, but it's intentionally retained to allow drift between the two repos without breaking the dashboard.
- The bridge currently only implements **plugin route registration**. The spec calls out event-bus and anti-corruption read layers as future shapes; the file is structured so those would be additional exports from the same module, preserving the "single seam" property.

## Code Review

**Reviewed by**: cx
**Date**: 2026-04-06

### Findings
- No issues found

### Fixes Applied
- None needed

### Notes
- Reviewed the branch diff, the bridge initialization and dispatch flow in `lib/dashboard-server.js`, the new `lib/pro-bridge.js` contract, and the coordinated `@aigon/pro` `register(api)` implementation. The feature cleanly moves `/api/insights` ownership behind the bridge without introducing a concrete regression in the reviewed paths.
