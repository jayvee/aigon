# Feature: dashboard-route-table-extract-api-handlers

## Summary
`lib/dashboard-server.js` is **3,083 lines** with **39 inline `/api/...` route branches** in a long if/else chain inside the main request handler. Extract the OSS route handlers into a route table pattern (`{ method, path, handler }`) that mirrors the shape of `lib/pro-bridge.js:dispatchProRoute()` — which feature 219 already shipped as the prior art for Pro routes. Goal: one mental model for how routes work (OSS + Pro), each handler testable in isolation, and a `dashboard-server.js` that holds infrastructure (HTTP, WebSocket, static serving, dispatcher) but no route-specific business logic. Incremental — extractions land one namespace at a time, each a shippable commit.

Ownership stays server-side: route eligibility, path matching, and dispatch live in Node modules under `lib/`; the dashboard frontend keeps calling the same `/api/...` endpoints and must not gain any new routing logic or duplicate knowledge of which actions are available.

## Safety principle (non-negotiable)

**This refactor must not change a single API response.** The e2e suite (`MOCK_DELAY=fast npm run test:ui`) exercises the exact routes being moved — it is the safety net. Every extraction commit runs the full pre-push check (`npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh`) before landing. Any extraction that breaks a test is reverted, not patched. No "flag day" where half the routes are moved and the other half are inline — each commit leaves the server in a fully-working state.

## Ground truth — current state (2026-04-06)

Measured with `wc -l` and `grep`:

- `lib/dashboard-server.js` — **3,083 lines** (grew +332 since the original spec was written at 2,751)
- **39** inline `/api/...` route branches (up from "20+" in the original spec)
- `lib/dashboard-status-collector.js` — **793 lines** (the read-side extraction already exists and is in production)
- `lib/dashboard-status-helpers.js` — **302 lines** (shared helpers for the collector)
- `lib/pro-bridge.js` — **191 lines** (the Pro-route dispatcher from feature 219 — already uses the route-table pattern this feature proposes to extend to OSS routes)
- `lib/dashboard-routes.js` — does not exist

What feature 219 already built:

```js
// lib/dashboard-server.js:2044-2046 — current pattern for Pro routes
if (proBridge.dispatchProRoute(req.method, reqPath, req, res)) {
    return; // pro-bridge handled it
}
// falls through to the 39 inline OSS route branches below
```

`proBridge.register({ method, path, handler })` already provides the contract. This feature extends the same pattern to cover OSS routes, not inventing a new one.

## User Stories
- [ ] As a maintainer, I can scan a single route table file and find any API endpoint in seconds, instead of grepping through 3,000+ lines of imperative handler blocks
- [ ] As a contributor, I can add a new endpoint by adding one entry to a route table — same shape as registering a Pro route today
- [ ] As a tester, I can exercise a route handler in isolation by calling its function, without standing up a full HTTP server
- [ ] As a reviewer, I can read `dashboard-server.js` and see only HTTP infrastructure — server lifecycle, WebSocket relay, static files, dispatcher — not business logic

## Acceptance Criteria

### Principle ACs

- [ ] **AC1** — Every extraction is an independent commit that passes `node --check aigon-cli.js && npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh` on its own. No multi-commit "flag day".
- [ ] **AC2** — Each extraction moves handler logic **verbatim** — no behavior changes, no response shape changes, no status code changes, no header changes. Logic refactors come in separate commits after the move.
- [ ] **AC3** — After every extraction, the e2e Playwright suite still passes without modification. The suite is the ground truth for "behavior unchanged".
- [ ] **AC4** — The OSS route dispatcher **shares shape** with `proBridge.dispatchProRoute(method, path, req, res)`. Either factor out a common dispatcher helper both use, or mirror the signature exactly so both look identical to a reader.
- [ ] **AC5** — No route handler lives inline in `dashboard-server.js` at the end. Every `/api/...` branch is registered through the route table.
- [ ] **AC6** — `lib/dashboard-server.js` shrinks after every extraction commit, and the removed inline branch is replaced only by dispatcher glue. No commented-out blocks, dead stubs, or duplicate fallback logic remain.

### Extraction strategy — by namespace, incrementally

Rather than trying to move all 39 routes in one commit, this feature groups routes into **namespaces** and extracts one namespace per commit. The exact namespace boundaries are the responsibility of the implementer, but a reasonable starting split is:

1. **Spec routes** — `GET /api/spec`, `POST /api/spec/create`, related spec-edit paths
2. **Detail + status routes** — `GET /api/detail/:type/:id`, `GET /api/status`, `POST /api/refresh`, related
3. **Action routes** — `POST /api/action` and dispatch table (large; may split further)
4. **Feature lifecycle routes** — `feature-start`, `feature-close`, `feature-autonomous-start` (the ones the dashboard spawns via `spawnSync(CLI_ENTRY_PATH)`), etc.
5. **Research lifecycle routes** — research equivalents
6. **Infra routes** — `/api/repos/:repo/dev-server/*`, supervisor status, logs, editor open, copy
7. **Session / peek / console routes** — session attach, peek, console tail, anything related to live session views
8. **Residue** — whatever doesn't fit cleanly; decision point at the end

The implementer may merge or split these namespaces based on what makes sense when reading the actual code. **The only rule is: one commit moves one coherent namespace end-to-end, and the e2e suite stays green after each commit.**

### Per-extraction ACs (apply to every namespace)

- [ ] **EN.1** — Catalog every `/api/...` branch in the namespace being moved, including method, path pattern, and current handler location
- [ ] **EN.2** — Create or extend `lib/dashboard-routes.js` with the extracted handlers
- [ ] **EN.3** — Each handler is registered as `{ method, path, handler }`, where `handler` receives the same request/response objects the inline branch used today plus a single dashboard server context object. The context is built in `lib/dashboard-server.js` and only carries shared server-side dependencies already owned there (for example repo metadata, config access, helper functions, and process helpers). Do not move mutable lifecycle authority into the route table.
- [ ] **EN.4** — Register the handlers through the new dispatcher (or the shared one with pro-bridge) in `dashboard-server.js`
- [ ] **EN.5** — Delete the old inline branches in `dashboard-server.js`
- [ ] **EN.6** — Path and method matching for the moved routes stays byte-for-byte compatible with the pre-extraction behavior, including dynamic segments such as `/api/detail/:type/:id`, query-string handling such as `/api/spec?path=...`, trailing-slash behavior if any, and 404 fallthrough for non-matches
- [ ] **EN.7** — Full pre-push check passes: `npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh`
- [ ] **EN.8** — Commit message follows `refactor(dashboard-routes): extract <namespace> from dashboard-server.js` and lists the routes moved
- [ ] **EN.9** — After any extraction that edits `lib/*.js`, run `aigon server restart` before manual dashboard verification so the served UI/API reflect the extracted handlers
- [ ] **EN.10** — After any dashboard-visible change, take a Playwright screenshot of the pipeline view as a manual sanity check that the UI still renders against the extracted routes

### Completion criterion

- [ ] **AC7** — At the end of all extractions, `lib/dashboard-server.js` contains only: HTTP server setup, WebSocket relay, static file serving, the dispatcher, and a small amount of glue. No inline `/api/...` branches, no route-specific business logic.
- [ ] **AC8** — `lib/dashboard-routes.js` (or split into namespace files like `lib/dashboard-routes-spec.js`, `lib/dashboard-routes-lifecycle.js`, etc. — implementer's call) holds every route handler.
- [ ] **AC9** — The OSS dispatcher and `proBridge.dispatchProRoute()` either share code or have visually identical shapes, so a reader sees one pattern.
- [ ] **AC10** — CLAUDE.md Module Map section is updated to reflect the new module(s).

## Validation

```bash
# After every extraction commit:
node --check aigon-cli.js
node -c lib/dashboard-server.js
node -c lib/dashboard-routes.js         # or whichever file the routes landed in
npm test
MOCK_DELAY=fast npm run test:ui
bash scripts/check-test-budget.sh
aigon server restart

# Final state:
wc -l lib/dashboard-server.js           # should be materially smaller than 3,083
wc -l lib/dashboard-routes*.js
grep -c "reqPath.startsWith('/api/'" lib/dashboard-server.js   # expect 0 for API route branches; static assets and non-API guards may remain
```

## Technical Approach

### Prior art — feature 219

`lib/pro-bridge.js:dispatchProRoute(method, path, req, res)` already implements the dispatch pattern for Pro routes. Its shape:

1. `proBridge.register({ method, path, handler })` adds a route to an in-memory registry
2. `proBridge.dispatchProRoute(method, path, req, res)` looks up the method+path in the registry and calls the handler if matched, returning `true`; otherwise returns `false` so the caller falls through

**This feature extends the same mechanism to OSS routes.** Either:

- **Option A**: add `ossRegister` / `dispatchOssRoute` to `lib/pro-bridge.js` (renaming the file is a separate question — it's a dispatcher, not a Pro-specific thing)
- **Option B**: create `lib/route-dispatcher.js` as the shared dispatcher, have both `lib/dashboard-routes.js` (OSS) and `@aigon/pro` (Pro) register against it
- **Option C**: create a dedicated `lib/dashboard-routes.js` with its own dispatcher that visually mirrors `proBridge.dispatchProRoute` — two dispatchers, one pattern

Decision point during implementation. Default: Option C for the first few extractions (lowest blast radius, no changes to pro-bridge.js), then evaluate merging into a shared helper once both dispatchers have real usage and we can see whether they're actually duplicating or just visually similar.

Whichever option is chosen, keep one source of truth for OSS route matching. Do not leave partial eligibility logic in `dashboard-server.js` that duplicates checks later performed by `lib/dashboard-routes.js`.

### Mechanical steps per extraction (repeat per namespace)

1. In `dashboard-server.js`, identify the block of `if (reqPath.startsWith('/api/<namespace>'))` branches to move
2. Read the full block — including any local helpers that the handlers depend on
3. Create or extend `lib/dashboard-routes.js`. Copy each handler verbatim, wrapped as a route-table entry `{ method, path, handler }`
4. Any local helpers that are only used by handlers in this namespace: move them too. Helpers shared with other (not-yet-extracted) parts of `dashboard-server.js`: leave in place, import them where needed
5. Register the new route-table entries through the dispatcher, in the same request-handling flow that currently has the inline branches
6. Delete the old inline branches from `dashboard-server.js`
7. Run `node -c` on both files to catch syntax errors
8. Run the full pre-push check (`npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh`)
9. Restart the local dashboard server with `aigon server restart`
10. If green: commit with a message listing the moved routes. If red: revert the commit, investigate, fix, retry
11. Take a Playwright screenshot of the dashboard pipeline view — sanity check the UI renders
12. Move to next namespace

### What is NOT changing

- **Any API response shape, status code, or header** — pure moves, verbatim
- **WebSocket protocol** — the relay stays in `dashboard-server.js`; WebSocket is infrastructure, not routes
- **Static file serving** — stays in `dashboard-server.js`
- **`lib/dashboard-status-collector.js`** — already extracted; this feature doesn't touch it
- **`lib/dashboard-status-helpers.js`** — already extracted; this feature doesn't touch it
- **`lib/pro-bridge.js`** — only touched if the implementer chooses Option A or B above
- **HTML template injection** — explicitly out of scope (the original spec lumped this in; it's a separate concern that deserves its own feature)
- **The supervisor / sweep loop** — not a route, not affected
- **The workflow engine** — not touched
- **Any route contract with the frontend** — the frontend calls `/api/...` URLs exactly as before
- **Workflow-core authority** — feature/research lifecycle state remains owned by `lib/workflow-core/` and existing server-side modules; the route table is only a dispatch organization change

### Test discipline

**Every extraction commit must pass the full pre-push check before landing.** The Playwright e2e suite exercises the following route paths directly through the UI:

- `POST /api/refresh` (forceRefresh)
- `POST /api/action` (every feature-prioritise / feature-start / feature-close / feature-eval button click)
- `GET /api/status` (the Kanban board render)
- `GET /api/session/*` (peek and terminal dialogs, mocked in tests but the path still matches)
- `GET /api/detail/:type/:id` (drawer content)
- `GET /api/spec?path=...` (Spec tab)

That's the ground truth for "the refactor didn't break anything." If the suite goes red during an extraction, something has moved behavior — revert immediately.

## Dependencies

- **Hard**: feature 219 (`lib/pro-bridge.js`) — already landed. Provides the prior-art pattern this feature extends.
- **Soft**: the e2e test suite being green and stable — already landed (see recent test-repair commits). Without a green suite, this refactor is unsafe to attempt.

## Out of Scope

- **HTML template injection consolidation** — separate feature; was in the original spec but lumped with routes for no good reason
- **Adding new API endpoints**
- **Changing API response shapes, status codes, or headers**
- **WebSocket protocol changes**
- **`dashboard-status-collector.js` refactors** — already extracted
- **`dashboard-status-helpers.js` refactors** — already extracted
- **Renaming `lib/pro-bridge.js`** — orthogonal question; can happen later if the dispatcher becomes shared
- **Introducing a routing library (Express, Fastify, Koa)** — the current minimal dispatcher is fine; this is about organization, not framework adoption
- **Hot-reload / dev mode for route files**
- **Auth / permissions refactors** — the existing model stays
- **TypeScript / JSDoc type annotations beyond what's already in the file**
- **Per-route unit tests** — the e2e suite covers routes end-to-end; adding per-handler unit tests is a separate discipline question

## Open Questions

- **Dispatcher sharing with pro-bridge** — Option A, B, or C above? Decide during the first extraction based on what reads most cleanly.
- **Single routes file vs per-namespace files** — `lib/dashboard-routes.js` vs `lib/dashboard-routes-spec.js` / `lib/dashboard-routes-lifecycle.js` / etc? Decide after the second or third extraction, based on how big the routes file is getting. Default: one file until it exceeds ~800 lines, then split.
- **Handler signature** — prefer `handler(req, res, ctx)` so the move stays close to today's inline code. If `proBridge` uses a different call shape, the registration/dispatch layer may adapt, but the route-table entry shape must remain visually aligned with Pro registration.

## Related

- **Prior art**: feature 219 (`pro-extension-point-single-seam-for-aigon-pro-integration`) — shipped the `lib/pro-bridge.js` dispatcher pattern
- **Sibling refactor**: feature `kill-utils-js-god-object` (inbox, formerly 193) — same "big file → smaller modules" direction, different file
- **Killed**: feature 194 (`command-config-runner-replace-imperative-handlers`) — tried to solve a similar "file size" problem with a generic runner, was over-abstracted. This feature deliberately avoids that trap by moving verbatim and mirroring an already-proven pattern (pro-bridge) rather than inventing a new one.
- **CLAUDE.md rule T1** (pre-push tests) — enforced at every extraction commit
- **CLAUDE.md rule T2** (new code ships with a test) — pure moves are exempted; commit message should call out which routes are covered by existing e2e suite and which aren't
- **CLAUDE.md Module Map** — needs updating at completion to reflect `lib/dashboard-routes.js` (or the namespace files)
