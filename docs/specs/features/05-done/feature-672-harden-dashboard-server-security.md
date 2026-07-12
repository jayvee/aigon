---
aigon_id: F672
complexity: high
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-12T10:02:09.615Z", actor: "cli/feature-prioritise" }
---

# Feature: harden-dashboard-server-security

## Summary

A security review of the Aigon dashboard server (`lib/dashboard-server.js` and
`lib/dashboard-routes/*`, `lib/dashboard-actions/*`, `lib/pty-session-handler.js`)
found that the local dashboard binds to **`0.0.0.0`** (all network interfaces)
with **no authentication, no CSRF/Origin protection on state-changing HTTP
endpoints, and a path-traversal flaw in the static file handlers.** Because the
dashboard can spawn autonomous coding agents, open PTYs into running agent
terminals, inject keystrokes into those terminals, run `aigon` lifecycle actions,
and read files, the current posture means **any host on the same LAN (coffee
shop, office, conference Wi-Fi), and in some cases any website the developer
merely visits, can drive the developer's machine.** All of these categories are
listed as *in scope* in `SECURITY.md` ("Path traversal or injection", "Authentication
bypass in the AIGON server / dashboard", "Code execution", "Credential leakage").

This feature hardens the server: bind to loopback by default, add
defense-in-depth Origin/Host validation, require a shared-secret token whenever
the operator opts into a non-loopback bind, fix the path traversal, and tighten
the repo-path allow-listing. `aigon-pro` was also reviewed — its exec surface uses
argument-array `spawnSync` (no shell string interpolation, no `execSync`), so no
Pro code changes are required; the findings are all in OSS `aigon`.

## Threat model

Aigon runs on a developer workstation and orchestrates AI agents that execute
code and shell commands with the developer's privileges. The dashboard is the
control plane. The realistic attackers are: (1) another device on the same
local network, and (2) a malicious web page the developer opens in a browser
(drive-by CSRF / DNS-rebinding). Per `SECURITY.md`, pure DoS against local
tooling is out of scope, so unbounded-body concerns are noted only as
defense-in-depth, not as the driver.

## Findings (verified during review)

### F1 — CRITICAL: dashboard binds `0.0.0.0` with zero authentication (root cause)
- `lib/dashboard-server.js:418` hardcodes `const host = '0.0.0.0';`. There is no
  config or env override. The entire API (grep confirmed: no `bearer`, `token`,
  `authorization`, CSRF, or session concept anywhere in the server) is served to
  every network interface.
- Consequence: every endpoint below is reachable, unauthenticated, from any host
  that can route to the machine (same subnet by default). This is the single
  root cause that amplifies every other finding.

### F2 — HIGH: path traversal → unauthenticated arbitrary file read
- `lib/dashboard-server.js:1145-1157` (`/assets/` handler) builds
  `path.join(ROOT_DIR, reqPath)` and `:1266-1276` (`/js/` handler) builds
  `path.join(templateRoot, 'templates', 'dashboard', reqPath)` with **no
  containment check** on the resolved path.
- `reqPath = (req.url||'/').split('?')[0]` is the raw request target. Node's HTTP
  server does **not** normalize `..` (verified: a client such as
  `curl --path-as-is` delivers `req.url` verbatim). `reqPath.startsWith('/assets/')`
  still passes for `/assets/../../../../etc/passwd`.
- Verified: `path.join('/Users/jviner/src/aigon', '/assets/../../../../../../etc/passwd')`
  resolves to `/etc/passwd`, which `fs.existsSync && isFile()` accepts and the
  handler streams back (`application/octet-stream`). Same for the `/js/` handler.
- Combined with F1, this is **remote, unauthenticated arbitrary file read**
  (SSH keys, `.env`, tokens, source).

### F3 — HIGH: no CSRF / Origin / Host validation on state-changing HTTP endpoints
- `POST /api/action` (`lib/dashboard-routes/system.js:158-160`) runs any
  allow-listed lifecycle action via `runDashboardInteractiveAction` — including
  `feature-start` / `feature-do` (spawns autonomous coding agents),
  `feature-delete`, `feature-reset`, `feature-push`, `dev-server`, etc.
- The request handler (`lib/dashboard-server.js:1101`) performs **no** Origin,
  Referer, or Host check. `readJsonBody` (`lib/dashboard-routes/util.js:14`)
  `JSON.parse`s the body regardless of `Content-Type`, so a malicious web page can
  send a CORS "simple request" (`text/plain`, no preflight) and the server will
  act on it. This makes the endpoints reachable via **drive-by CSRF and
  DNS-rebinding**, not only the LAN.
- Other state-changing endpoints with the same gap:
  `POST /api/session/terminal-input` (`sessions.js:355`) injects arbitrary
  keystrokes + Enter into a live agent tmux session — i.e. an attacker can *type
  commands into a running agent's terminal*; `POST /api/session/run`,
  `/api/session/stop`, `/api/session/view`, `/api/attach`, `/api/sessions/cleanup`,
  `/api/session/ask`, and the `/api/repos/.../dev-server/start` family.

### F4 — MEDIUM: PTY / full-shell access reachable by any LAN client
- `lib/pty-session-handler.js` *does* gate the PTY WebSocket with an Origin
  allow-list (`isValidOrigin`, loopback/`.localhost` only) plus a single-use
  token. That defends against browser drive-by, but **not** against a non-browser
  LAN client: `Origin` is a request header any client can set freely, and
  `GET /api/pty-token` (`sessions.js:298`) mints tokens with **no auth and no
  Origin check**. So a LAN attacker can: fetch a token → open
  `ws://host:port/api/session/pty/<session>` with a spoofed `Origin: http://localhost`
  → get a **full interactive PTY attached to a running agent's tmux session**
  (arbitrary shell as the developer). This is gated today only by F1's absence of
  network isolation.

### F5 — MEDIUM: `repoPath` allow-list bypass when no repos are registered
- `resolveDashboardActionRepoPath` (`lib/dashboard-action-command.js:108-132`):
  when `registeredRepos` is empty, an attacker-supplied `repoPath` is returned
  **unchecked** (the `repos.length > 0 && !repos.includes(requested)` guard is
  skipped), so actions run in an arbitrary caller-chosen directory. Even when
  repos are registered, the check is an exact `path.resolve` string match — fine,
  but the empty-list branch is a hole. Should fail closed.

### F6 — LOW / defense-in-depth: unbounded request body
- `readJsonBody` (`util.js:14-27`) and the inline body reader
  (`dashboard-server.js:238`) accumulate the whole body in memory with no cap.
  DoS against local tooling is explicitly out of scope in `SECURITY.md`, so this
  is tracked only as hardening, not as a primary driver — add a sane cap (e.g.
  reject bodies over ~1 MB) while we are in the file.

## User Stories
- [ ] As a developer running Aigon on a laptop on shared Wi-Fi, no other device
      on the network can read my files, drive my agents, or open a shell on my
      machine through the dashboard.
- [ ] As a developer, visiting a malicious website cannot trigger Aigon actions,
      spawn agents, or inject keystrokes into my agent terminals via my running
      dashboard.
- [ ] As a Docker/OrbStack user who needs the dashboard reachable from a
      container, I can opt in explicitly (bind address + shared secret) without
      that being the insecure default for everyone.

## Acceptance Criteria
- [ ] **F1:** The server binds to `127.0.0.1` (loopback) by default. Any wider
      bind (`0.0.0.0` / specific interface) is opt-in via explicit config/env
      (e.g. `AIGON_SERVER_HOST` or dashboard config) and, when the bind is
      non-loopback, a shared-secret token is **required**. The server refuses to
      start a non-loopback bind unless the token is already configured via env or
      config; token auto-generation UX is deferred.
- [ ] **F2:** `/assets/` and `/js/` handlers reject any request whose resolved
      absolute path is not contained within the intended base directory
      (`path.resolve` + prefix check with a trailing separator, or reject any
      `reqPath` containing `..` / encoded `..` before joining). Regression test
      asserts `/assets/../../../../etc/passwd` → 404/400, not file contents.
- [ ] **F3:** All state-changing endpoints (POST/DELETE, PTY-token mint) validate
      that `Origin`/`Referer` (when present) is loopback/`.localhost`, and reject
      requests whose `Host` header is not loopback/`.localhost`/an allow-listed
      host (DNS-rebinding defense). When a shared secret is configured, a matching
      token is required on every dashboard HTTP route, including read-only GETs,
      so a non-loopback bind is fully gated. GET read-only endpoints may stay
      token-free only in the default loopback mode, but must still pass the Host
      check.
- [ ] **F3a (token transport):** The token must be accepted from an
      `X-Aigon-Token` header **and** from an equivalent source usable by requests
      that cannot set custom headers, because header-only enforcement would make a
      fully-gated non-loopback dashboard unloadable. Specifically: the top-level
      HTML document load (`GET /`, an address-bar navigation) and the SSE
      `EventSource` streams (`/api/events`, `/api/session/stream`) cannot attach
      custom headers from the browser. Support a bootstrap path — a one-time
      token in the URL that the server exchanges for an `HttpOnly`, `SameSite`
      cookie (or an equivalent query-param token for the SSE streams) — so the
      document, its assets, and the SSE channels authenticate without a custom
      header. XHR/`fetch` calls continue to use the header. A test asserts that,
      with a secret configured on a non-loopback bind, `GET /` and `/api/events`
      succeed via the cookie/query bootstrap and fail without it.
- [ ] **F4:** `GET /api/pty-token` requires the same Origin/Host (and token, when
      configured) checks as other privileged endpoints, so a bare LAN client
      cannot mint a token. The PTY WebSocket upgrade path also runs the shared
      Host/token guard before the existing single-use PTY token check; its
      existing Origin allow-list remains in place.
- [ ] **F5:** `resolveDashboardActionRepoPath` fails closed: when no repos are
      registered, a caller-supplied `repoPath` is rejected (or constrained to the
      server's own cwd) rather than honored blindly.
- [ ] **F6:** Request-body readers enforce a maximum size and abort oversized
      requests. (Defense-in-depth; keep the change minimal.)
- [ ] The dashboard UI and Playwright smoke tests still pass on the default
      loopback bind (the browser talks to `localhost`, so no UX regression).
- [ ] `SECURITY.md` / `docs/architecture.md` note the new bind + token model so
      the trust boundary is documented.

## Validation
```bash
# unit + integration for the new guards (targeted — do NOT run full deploy gate)
node --test tests/unit/dashboard-server-security.test.js
node --test tests/integration/pty-terminal.test.js
npm run test:browser:smoke
```

## Pre-authorised

## Technical Approach
- **Bind default (F1):** replace the hardcoded `host = '0.0.0.0'` with a resolver
  that defaults to `127.0.0.1`, reads an override from config/env, and — for any
  non-loopback bind — requires a configured shared secret or refuses to start
  with a clear error. Keep the Caddy `.localhost` proxy path working (it targets
  `127.0.0.1:<port>` already, per `lib/server-runtime.js`). Do not auto-generate
  a token in this feature; operators who opt into non-loopback access must
  provide one explicitly.
- **Central guard middleware (F3/F4):** add shared helpers in
  `lib/dashboard-security.js` and invoke them from both entry points:
  `lib/dashboard-server.js` before route dispatch/static handling, and the
  `server.on('upgrade')` PTY WebSocket branch before delegating to
  `pty-session-handler.js`. The helper should: (a) validate `Host` against a
  loopback/allow-list; (b) validate `Origin`/`Referer` for non-GET and token-mint
  requests; (c) check the shared secret whenever configured, reading it from the
  `X-Aigon-Token` header for XHR/`fetch`, and from the bootstrap cookie/query
  token for header-less requests (F3a). Return 403 (or close the upgrade socket
  without handing it to the PTY handler) on failure. Reuse `isValidOrigin` from
  `pty-session-handler.js` by extracting it to the shared module rather than
  duplicating host parsing.
- **Token bootstrap for header-less loads (F3a):** when a secret is configured,
  accept a one-time token in the `GET /` URL, set an `HttpOnly`/`SameSite=Strict`
  session cookie, and honour that cookie (and a query-param token for
  `EventSource` streams) so the document, static assets, and SSE channels
  authenticate without a custom header. `fetch`/XHR keeps using `X-Aigon-Token`.
  In default loopback mode none of this engages.
- **Path containment (F2):** add a `resolveWithinBase(baseDir, reqPath)` helper
  that `path.resolve`s and verifies `resolved === base || resolved.startsWith(base + path.sep)`;
  use it in both static handlers. Reject `..`/`%2e` early as belt-and-suspenders.
- **Fail-closed repo resolution (F5):** in `resolveDashboardActionRepoPath`, when
  `repos.length === 0` and a `requested` path is supplied, only accept it if it
  equals the resolved default repo/cwd; otherwise 403.
- **Body cap (F6):** wrap the `req.on('data')` accumulators with a byte counter
  that `req.destroy()`s past the limit and rejects the promise.
- **Tests:** cover default loopback binding, non-loopback startup refusal without
  a token, Host/Origin rejection, token success/failure when configured, the F3a
  cookie/query bootstrap for `GET /` and `/api/events` (succeeds with the
  bootstrap, 403 without), static traversal rejection for `/assets/` and `/js/`,
  `repoPath` fail-closed behavior, and PTY token/upgrade protection.
- Keep changes surgical and covered by a focused unit test file plus the browser
  smoke subset; **do not** run the full `test:deploy` gate mid-iteration (repo
  testing guidance). Restart the server after `lib/*.js` edits.

## Dependencies
- None. Self-contained within `lib/dashboard-*` + `lib/pty-session-handler.js`.

## Out of Scope
- `aigon-pro` code changes — its exec paths use argument-array `spawnSync` with no
  shell string interpolation and no `execSync`; review found no injection there.
- Full authenticated multi-user access control / TLS. The goal is to restore the
  "trusted localhost" boundary the code already assumes, not to build a
  hardened multi-tenant server.
- Rate limiting / DoS protection beyond the single body-size cap (out of scope
  per `SECURITY.md`).
- Dashboard client-side XSS hardening (self-XSS requiring local access is out of
  scope per `SECURITY.md`); revisit separately if stored-XSS via repo data is
  found.

## Open Questions
- Exact config key names for the bind address and shared secret should follow
  the existing dashboard/server config naming during implementation. The
  behavior is fixed: loopback by default, explicit non-loopback opt-in, and a
  required operator-provided token for non-loopback mode.

## Related
- Security policy scope: `SECURITY.md` (§ Scope — all findings in-scope)
- Server: `lib/dashboard-server.js`, `lib/server-runtime.js`
- Routes: `lib/dashboard-routes/{system,sessions,config,util}.js`
- Actions: `lib/dashboard-actions/run-interactive.js`, `lib/dashboard-action-command.js`
- PTY: `lib/pty-session-handler.js`
