---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-30T04:29:16.364Z", actor: "cli/feature-prioritise" }
---

# Feature: Non-blocking Dashboard Status Poll

## Summary

The dashboard background poll calls `collectDashboardStatusData()` synchronously inside `pollStatus()`. Because this is synchronous JavaScript on Node's single-threaded event loop, it blocks **all** incoming HTTP requests — including `/api/action` POSTs — for the entire duration of the collection. Measured at 750 ms–1.1 s on a warm cache with 7 registered repos (the aigon repo alone contributes ~755 ms warm due to its 880+ spec files). Confirmed in the production action log: `feature-prioritise social-sharing` took **6,570 ms** (`2026-04-30T03:56:47Z`) because the action POST arrived while a background poll was running and had to queue behind it.

The fix is to add an async variant of `collectDashboardStatusData` that yields the event loop between repo scans via `setImmediate`, then use it in the poll path. Each individual blocking chunk stays ≤ ~160 ms (one repo), allowing HTTP requests to be processed between them. No threads, no serialisation, no inter-process state.

## User Stories

- As a developer using the dashboard, when I click Prioritise / Start / Close on a feature card, I expect the action to respond in under 1 second regardless of whether a background status poll is running at that moment.
- As a developer, after any action completes the board should immediately reflect the new state (card moves columns) — the post-action refresh must still return fresh data, not the stale pre-action snapshot.

## Acceptance Criteria

- [ ] A new async function `collectDashboardStatusDataAsync` exists in `lib/dashboard-status-collector.js`, is exported, and is a functional equivalent of the sync `collectDashboardStatusData` with `setImmediate` yields between repo scans.
- [ ] `pollStatus()` in `lib/dashboard-server.js` `await`s `collectDashboardStatusDataAsync` instead of calling `collectDashboardStatusData` synchronously.
- [ ] The `/api/refresh` handler in `lib/dashboard-routes/system.js` is async and `await`s `ctx.helpers.pollStatus()` before calling `ctx.sendJson`.
- [ ] The existing sync `collectDashboardStatusData` function is **unchanged** — startup and in-band callsites still use it.
- [ ] `AIGON_DASH_TIMING=1` perf logging in `pollStatus()` still produces correct output.
- [ ] `refreshLatestStatus()` at server startup (sync, `lib/dashboard-server.js:1715`) is unchanged.
- [ ] `npm test` passes without modification.
- [ ] `MOCK_DELAY=fast npm run test:ui` passes.
- [ ] Manual: trigger a dashboard action (Prioritise/Start) during normal server operation — response < 1 s.
- [ ] Manual: immediately after action, board reflects updated state (fresh data returned by `/api/refresh`).
- [ ] Manual: fresh server start — board renders fully on first page load with no empty-repos flash.

## Validation

```bash
npm test
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Technical Approach

### Background: why the event loop blocks

`collectDashboardStatusData()` (`lib/dashboard-status-collector.js:1500`) iterates all registered repos via a synchronous `forEach`, calling `collectRepoStatus()` for each. Inside each call: `getRepoSpecIndex()`, workflow snapshot reads, and many other sync `fs.*Sync` operations run without yielding. The entire iteration holds the event loop hostage as one uninterrupted block.

`pollStatus()` (`lib/dashboard-server.js:1960`) is declared `async` but calls `collectDashboardStatusData()` synchronously — there is no `await` before it. In JavaScript, an async function runs synchronously up to its first `await`. So even when `pollStatus()` is called without `await` from the `/api/refresh` handler, the synchronous collection runs immediately on the same tick, blocking the event loop before `sendJson` can fire.

### The fix: three targeted changes

**Change 1 — add `collectDashboardStatusDataAsync` to `lib/dashboard-status-collector.js`**

Add a new async variant alongside the existing sync function. Do **not** modify the existing `collectDashboardStatusData()`.

```javascript
async function collectDashboardStatusDataAsync(options = {}) {
    const perfEnabled = options.collectPerf === true;
    const perfStart = perfEnabled ? nowMs() : 0;
    const response = {
        generatedAt: new Date().toISOString(),
        repos: [],
        summary: { implementing: 0, waiting: 0, complete: 0, error: 0, total: 0 },
        proAvailable: isProAvailable(),
        updateCheck: getCachedUpdateCheck(),
    };

    for (const repoPath of readConductorReposFromGlobalConfig()) {
        await new Promise(resolve => setImmediate(resolve)); // yield to event loop
        const repoStatus = collectRepoStatus(path.resolve(repoPath), response, options);
        if (!repoStatus) continue;
        if (perfEnabled && repoStatus._perf) {
            if (!response._perf) response._perf = { totalMs: 0, repos: [] };
            response._perf.repos.push(repoStatus._perf);
            delete repoStatus._perf;
        }
        response.repos.push(repoStatus);
    }

    scheduleNpmUpdateCheck();
    if (perfEnabled) {
        response._perf = response._perf || { repos: [] };
        response._perf.totalMs = Math.round((nowMs() - perfStart) * 100) / 100;
    }
    return response;
}
```

Export it alongside the existing sync function in `module.exports`.

**Change 2 — update `pollStatus()` in `lib/dashboard-server.js:1964`**

```javascript
// Before
latestStatus = collectDashboardStatusData(process.env.AIGON_DASH_TIMING === '1' ? { collectPerf: true } : undefined);

// After
latestStatus = await collectDashboardStatusDataAsync(process.env.AIGON_DASH_TIMING === '1' ? { collectPerf: true } : undefined);
```

Import `collectDashboardStatusDataAsync` at the top of the file. Preserve the `try/catch` error handling around this call exactly — `pollStatus()` swallows errors to prevent server crashes; do not change that behaviour.

**Change 3 — update `/api/refresh` handler in `lib/dashboard-routes/system.js:77`**

```javascript
// Before
handler(req, res, ctx) {
    ctx.helpers.pollStatus();
    ctx.sendJson(200, ctx.getLatestStatus());
}

// After
async handler(req, res, ctx) {
    await ctx.helpers.pollStatus();
    ctx.sendJson(200, ctx.getLatestStatus());
}
```

This preserves the existing contract: `/api/refresh` returns **fresh** data, not the stale snapshot from the previous cycle. The response time stays ~750 ms, but during that time the event loop is free to process other requests.

**Optional: expose `collectDashboardStatusDataAsync` on `ctx.routes`**

At `lib/dashboard-server.js:2153`, `collectDashboardStatusData` is passed into the routes context. Add `collectDashboardStatusDataAsync` to the same object to make it available for future conversion of the in-band callsites (out of scope here, but laying the pipe now is low-cost).

## Dependencies

- `lib/dashboard-status-collector.js` — new async export
- `lib/dashboard-server.js` — `pollStatus()` updated, new import
- `lib/dashboard-routes/system.js` — `/api/refresh` handler made async

No schema changes, no new npm packages, no template changes.

## Out of Scope

- Converting the in-band `collectDashboardStatusData()` calls in `lib/dashboard-routes/entities.js` (lines 218, 429, 460, 543, 615) and `lib/dashboard-routes/config.js` (lines 71, 114, 155, 335, 362). These block the event loop while serving a specific user-triggered request, but they are NOT the background-poll race. They are a follow-up task.
- Making `collectRepoStatus()` itself async (converting all internal `fs.*Sync` calls). That is a much larger refactor with high risk.
- Worker threads or child process approaches for status collection.

## Risks and Areas to Verify

### R1 — `/api/refresh` response time is still ~750 ms

**What changes:** Before, the handler blocked the event loop for ~750 ms synchronously, then sent the response. After, the handler awaits the async collection (~750 ms with free event loop between repos), then sends the response. The HTTP round-trip duration is **unchanged** (~750 ms). The difference: other requests are now processed during that time.

**Verify:** Open browser DevTools → Network. Trigger an action. Confirm `/api/refresh` returns fresh state (card moves columns). ~750 ms response time is expected and acceptable.

### R2 — Concurrent `pollStatus()` executions

`pollStatus()` is now truly async. If the background timer and a `/api/refresh` request fire at the same instant, two concurrent `pollStatus()` calls run `collectDashboardStatusDataAsync()` in parallel — each does a full file I/O scan. Both complete and `latestStatus` is set twice (last write wins). No corruption: it is a plain assignment of an immutable snapshot.

This race already exists today (the timer and any `/api/refresh` call can overlap right now). The async change makes it no worse. A deduplication guard (`isPollRunning` flag) would be a safe addition but is not required for this feature.

**Verify:** Check that no test or production code expects `pollStatus()` to be idempotent within a single event loop tick.

### R3 — `latestStatus` is stale during async collection

Between `setImmediate` yields, the event loop processes HTTP requests. Requests that read `ctx.getLatestStatus()` (e.g., `/api/status`, `/api/detail`) will see the **previous poll's data** until the collection completes. This is existing behaviour — between 20-second poll cycles, every request reads stale data. The async change does not regress this.

**Verify:** No handler other than `/api/refresh` should have an assumption that `latestStatus` is "current as of this request." Grep for `getLatestStatus()` calls and confirm they are all read-only consumers of whatever the latest cached snapshot is.

### R4 — Background timer does not `await` `pollStatus()`

`lib/dashboard-server.js:2517`:
```javascript
setTimeout(() => { pollStatus(); scheduleNextPoll(); }, delay).unref();
```

`pollStatus()` is fire-and-forget from the timer — this is intentional. `scheduleNextPoll()` fires immediately; the 20-second interval is measured from poll *start*, not poll *completion*. With the async change this behaviour is unchanged: `pollStatus()` starts, yields, and the timer callback completes. The poll continues asynchronously in the background.

**Verify:** Server logs should continue to show `Next poll in 20s` immediately after `Poll complete`, not 20 + 0.75 s.

### R5 — Error handling in `pollStatus()` try/catch

The `try/catch` in `pollStatus()` currently catches synchronous errors from `collectDashboardStatusData`. With `await collectDashboardStatusDataAsync()`, Promise rejections are also caught by the same `try/catch` — `await` inside a `try/catch` correctly handles both. No change needed.

**Verify:** Simulate a collection failure (e.g., pass a bad repo path, or temporarily stub `collectDashboardStatusDataAsync` to throw). Confirm the server logs the error, skips that poll cycle, and continues polling without crashing.

### R6 — `scheduleNpmUpdateCheck()` inside the async function

`scheduleNpmUpdateCheck()` runs near the end of `collectDashboardStatusDataAsync` after all repos are scanned, same as in the sync version. It is a best-effort background trigger with no synchronous preconditions.

**Verify:** Confirm `scheduleNpmUpdateCheck()` has no assumptions about being called in a specific event-loop phase. It should be purely fire-and-forget.

### R7 — Pro module and `ctx.routes.collectDashboardStatusData`

`lib/dashboard-server.js:2153` passes `collectDashboardStatusData` into the routes context used by all route handlers including any pro-owned routes. If `@aigon/pro` calls `ctx.routes.collectDashboardStatusData()` directly, it still gets the **sync** version — that is correct, since the in-band pro routes are out of scope.

**Verify:** Search `aigon-pro` source for `collectDashboardStatusData`. If it calls it via the routes context, confirm it is not expecting to call the async version. If pro also needs the async variant, add `collectDashboardStatusDataAsync` to `ctx.routes` at line 2153.

### R8 — Test: `dashboard-health-route.test.js` contract

`tests/integration/dashboard-health-route.test.js:39` mocks `collectDashboardStatusData` to **throw** if called from `/api/health`. This test asserts the health route uses only the cached snapshot. The new `collectDashboardStatusDataAsync` function must **not** be called by `/api/health`. If `collectDashboardStatusDataAsync` is added to `ctx.routes`, the health route's test mock should also stub it with a throw to catch accidental calls.

**Verify:** `npm test` passes. If `collectDashboardStatusDataAsync` is added to `ctx.routes`, update the health route test mock to also stub the async variant.

### R9 — `refreshLatestStatus()` at startup must stay synchronous

`lib/dashboard-server.js:1693–1715` — `refreshLatestStatus()` calls the sync `collectDashboardStatusData()` and is invoked at line 1715 before the HTTP server binds. This is intentional: the server needs a valid `latestStatus` snapshot before serving any requests. Do **not** change this to async. If the async variant is accidentally used here, the server would start accepting requests before `latestStatus` is populated, causing `/api/status` to return an empty-repos array on every first hit.

**Verify:** After the change, start the server fresh (`aigon server restart`), open the dashboard immediately, and confirm the board renders fully on first load without an empty-repos flash.

### R10 — `async handler` syntax is supported by the route registration system

`lib/dashboard-routes/system.js` route objects use `handler(req, res, ctx) {}` syntax. The route dispatcher in `lib/dashboard-server.js` calls these handlers. Confirm that the dispatcher correctly handles a handler returning a Promise (i.e., it does not swallow unhandled rejections from async handlers). If the dispatcher does not currently `await` handler return values, an unhandled rejection from the async `/api/refresh` handler could silently drop errors.

**Verify:** Find where route handlers are invoked in `lib/dashboard-server.js`. Check if the invocation is `route.handler(req, res, ctx)` (plain call) or `await route.handler(req, res, ctx)`. If plain call: async handler errors will be unhandled rejections. Either update the dispatcher to `await` all handlers, or add a `.catch(err => sendJson(500, { error: err.message }))` wrapper on the async handler's returned Promise specifically for this route. **This is the most likely gotcha — verify it first before writing any other code.**

### R11 — `collectDashboardStatusDataAsync` must not duplicate `readConductorReposFromGlobalConfig()` side effects

`readConductorReposFromGlobalConfig()` reads `~/.aigon/config.json` on every call. In the async variant the call happens once at the start of the function (before the `for...of`), so the repo list is snapshotted for the duration of the scan. If a repo is added/removed mid-scan, the scan uses the list from when it started. This is identical behaviour to the sync version.

**Verify:** The repo list is read once, before the loop, not once per iteration. Confirm the `for...of` iterates over the snapshotted list, not a generator that re-reads the config on each iteration.

## Related

- Research: none
- Set: none