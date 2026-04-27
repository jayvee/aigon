---
complexity: high
---

# Feature: remove-server

## Summary

Allow the Aigon dashboard to connect to a server running on a different machine. Today the server and dashboard are co-located: the server serves the dashboard HTML and the dashboard calls `/api/*` relative URLs back to the same origin. This feature decouples them so a user can run the Aigon server on a "repo machine" (the machine that has the git worktrees and runs agents) while viewing the dashboard from any browser on the network — including a different laptop, tablet, or headless CI host.

## User Stories

- [ ] As a developer, I can point my browser at `http://repo-machine.local:4100` from a different laptop and see my full Aigon dashboard without any additional setup.
- [ ] As a developer, I can run `aigon server start` on a headless machine (no monitor/GUI) and then open the dashboard on my local machine, so the server never needs a local desktop environment.
- [ ] As a developer, I can set `AIGON_API_TOKEN` on the server to require a bearer token, so the API is not open to anyone on the network.
- [ ] As a developer, terminal-open and feature-open buttons on the dashboard gracefully handle the fact that the server is remote (e.g., show the tmux session name / SSH instructions instead of trying to open a local window).

## Acceptance Criteria

- [ ] Server binds `0.0.0.0:4100` (already true) and serves the dashboard HTML with correct CORS headers when `Access-Control-Allow-Origin` is configured.
- [ ] Dashboard HTML served by the server uses the server's own origin for all `/api/*` fetch calls — no hardcoded `localhost` references.
- [ ] `AIGON_API_TOKEN` env var (or `apiToken` in `~/.aigon/config.json`) activates bearer-token middleware on all `/api/*` routes; requests without a valid `Authorization: Bearer <token>` header get `401`.
- [ ] When `apiToken` is set, the dashboard reads `AIGON_API_TOKEN` (injected into the served HTML at startup via a `<script>window.AIGON_API_TOKEN=...` block) and sends it with every fetch.
- [ ] CORS: when `allowedOrigins` is set in config (list of allowed origins), the server sets `Access-Control-Allow-Origin` appropriately; when unset, defaults to the same-origin case (no CORS header needed).
- [ ] `aigon doctor` reports if the server is reachable from a configured `serverUrl`.
- [ ] Terminal-action endpoints (`/api/attach`, `/api/feature-open`) return a structured `{ type: 'remote', sessionName, hint }` response (instead of spawning a local tmux window) when the request comes from a different origin, so the dashboard can render a helpful "ssh into repo-machine and run: `tmux attach -t <name>`" message.
- [ ] `npm test` passes; `MOCK_DELAY=fast npm run test:ui` passes.

## Validation

```bash
node --check lib/dashboard-server.js
node --check lib/dashboard-routes.js
node --check lib/config.js
npm test
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.
- May add up to +60 LOC to `scripts/check-test-budget.sh` CEILING for new middleware unit tests.

## Technical Approach

### Current state

- Server binds `0.0.0.0:4100`, no auth, no CORS headers.
- Dashboard HTML is served as a static file by the same server; all fetch calls use relative paths (`/api/status`), so same-origin always works.
- Terminal spawn (`/api/attach`, `/api/feature-open`) shells out to `tmux` on the local machine and opens an iTerm2/Warp tab via AppleScript — fundamentally local.

### Proposed changes

**1. CORS middleware (lib/dashboard-server.js)**

Add a `cors` middleware (no new npm deps — implement inline or with a tiny helper) that reads `config.allowedOrigins` (array of URL strings, e.g. `["http://laptop.local:3000"]`). On each request, if the `Origin` header matches, set `Access-Control-Allow-Origin: <origin>` and `Vary: Origin`. Handle `OPTIONS` preflight. When `allowedOrigins` is unset or empty, no CORS headers are added (same-origin default preserved).

**2. Bearer token middleware (lib/dashboard-server.js)**

Read `process.env.AIGON_API_TOKEN` (or `config.apiToken`) at startup. If set, register a middleware on all `/api/*` routes that checks `Authorization: Bearer <token>`. Static routes (`/`, `/styles.css`, `/assets/*`) are exempt so the page loads before the token is known to the browser. Return `{ error: 'unauthorized' }` + status 401 on mismatch.

**3. Token injection into served HTML (lib/dashboard-server.js)**

When serving `index.html`, if `apiToken` is configured, inject `<script>window.AIGON_CONFIG = { apiToken: "..." };</script>` before `</head>`. The dashboard JS (`templates/dashboard/js/api.js`) reads `window.AIGON_CONFIG?.apiToken` and adds `Authorization: Bearer <token>` to all fetch calls.

**4. Config schema (lib/config.js)**

Add two optional fields to the global config schema:
- `apiToken` (string) — if set, enables auth middleware
- `allowedOrigins` (string[]) — if set, enables CORS for listed origins

Both can be overridden via env vars: `AIGON_API_TOKEN`, `AIGON_ALLOWED_ORIGINS` (comma-separated).

**5. Remote terminal detection (lib/dashboard-routes.js)**

In the `/api/attach` and `/api/feature-open` handlers, detect whether the request originated from a different host (compare `req.headers.origin` or `req.headers.host` to the server's own bound hostname). If remote, return a JSON response:
```json
{ "type": "remote", "sessionName": "aigon-f42-cc", "hint": "tmux attach -t aigon-f42-cc" }
```
Dashboard renders this as an info banner rather than trying to execute AppleScript.

**6. No separate dashboard-serve process**

The simplest split is: user opens `http://server-machine:4100` from their local browser. The server already serves the HTML — this is same-origin, so CORS doesn't apply. Auth token protects the API. This covers the primary use case without requiring a separate static-file server.

**7. Docs update**

Add a section to the README / docs about the remote server setup: how to set `AIGON_API_TOKEN`, how to open the dashboard from another machine, what works remotely (status, actions, session streaming) vs what requires SSH (terminal open).

### What does NOT change

- Filesystem polling and agent execution remain on the server machine (by design).
- WebSocket PTY streaming continues to work across the network (WebSockets work fine cross-origin once CORS is configured).
- Port 4100 default is unchanged.

## Dependencies

- None (no new npm packages; no other features required).

## Out of Scope

- Full SSH-based remote terminal execution (opening an iTerm2 window on a remote machine).
- TLS/HTTPS termination at the Aigon layer (use a reverse proxy like Caddy or Nginx for that).
- Multi-server fan-out (one dashboard watching multiple remote servers).
- OAuth or multi-user authentication.

## Open Questions

- Should the token appear in the served HTML (injected inline script) or should the user enter it in a dashboard login form? Inline injection is simpler and matches the current single-user model; a login form adds complexity and a state machine. Suggest: inline injection for now, login form is out of scope.
- Do we want `aigon config set apiToken <value>` as a CLI convenience, or just document the env var / manual JSON edit?

## Related

- Research: <!-- none -->
- Set: <!-- standalone -->
