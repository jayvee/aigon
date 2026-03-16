---
status: submitted
updated: 2026-03-16T10:46:13.626Z
---

# Research Findings: radar dashboard radical simplification

**Agent:** Claude (cc)
**Research ID:** 11
**Date:** 2026-03-16

---

## Key Findings

### Q1: What does the dashboard actually need to do?

**What users rely on (must keep):**
- **Status visibility**: Monitor view showing feature cards with agent status (implementing/waiting/submitted/error), timestamps, and summary counts
- **Pipeline/Kanban board**: Drag-drop features between stages (inbox → backlog → in-progress → evaluation → done)
- **Operator actions**: Setup agents, trigger feature-do/eval/close, open worktrees — all via POST to `/api/action` which runs CLI commands synchronously
- **Spec creation and editing**: Create new feature/research/feedback specs, edit in-place with the spec drawer
- **Session management**: List tmux sessions, attach/kill, identify orphans
- **Analytics**: Cycle time, leaderboards, completion stats (read-only, low-frequency)

**What doesn't work reliably (candidate for removal):**
- **WebSocket terminal relay**: Fails when tmux session dies before WebSocket connects, when session names conflict, and when daemon restarts mid-session. Uses 3 CDN scripts (xterm.js + FitAddon + WebGL addon) and ~200 lines of relay code on the server side (`lib/utils.js:3005-3137`) plus ~250 lines on the client side
- **Live spec sync detection**: A 3-second poller that detects if an AI agent modified a spec while the terminal panel is open — band-aid for a larger problem

**Assessment**: The dashboard's interactive features (monitor, pipeline, actions, spec editing) are the core value. The terminal relay is the primary source of fragility and should be replaced, not fixed.

### Q2: How to support production (main) + dev (worktree) simultaneously?

**Current architecture conflicts:**
- Both instances register in the same `~/.aigon/dev-proxy/servers.json`
- Both try to generate the same Caddyfile at `~/.aigon/dev-proxy/Caddyfile`
- Port allocation starts at 4201 for worktrees, but the main instance uses hardcoded 4100
- Caddy reload is a global operation that affects all routes

**Recommended approach — port-per-instance with discovery file:**
1. **Main instance**: Always port 4100 (hardcoded, stable for bookmarks)
2. **Dev instances**: Deterministic port from branch name hash in range 4101-4199 (like [Portree](https://github.com/fairy-pitta/portree)), with `detect-port` fallback if occupied
3. **Discovery file**: `~/.aigon/instances/<name>.json` containing `{ port, pid, worktree, startedAt }`. CLI reads these for `aigon radar list`
4. **No proxy needed**: `localhost:4100` for prod, `localhost:4101` for dev. No Caddy, no dnsmasq, no root access

**localStorage isolation**: Currently all `localhost` origins share localStorage regardless of port. The dashboard stores preferences (selected repo, filter, view, collapsed state) in localStorage. Must namespace keys by instance (e.g., prefix with `aigon-main-` vs `aigon-feature-69-`) to prevent cross-instance pollution.

**Evidence**: Vite, webpack-dev-server, and Next.js all use simple port auto-increment. Jupyter uses runtime discovery files at `~/.local/share/jupyter/runtime/`. No mainstream dev tool requires a reverse proxy for multi-instance local development.

### Q3: Can dev radar serve modified dashboard against live production data?

**Yes**, and this is straightforward with the port-per-instance model:
- The dev radar process reads the same `~/.aigon/config.json` (global config) and the same repo paths
- `collectDashboardStatusData()` scans filesystem paths that are repo-agnostic — it reads from `docs/specs/features/` in whatever repos are registered
- The dashboard HTML (`templates/dashboard/index.html`) is read fresh on each request — so a modified dashboard in the worktree is served immediately without restart
- The backend code in `lib/utils.js` requires a restart after changes (per CLAUDE.md), but that only affects the dev instance on its own port

**Key insight**: The data source (spec files, log files, tmux sessions) is shared across all instances. Only the serving code differs. A dev instance can serve a modified UI against real production data by default.

### Q4: Can Caddy/dnsmasq be eliminated entirely?

**Yes. What is lost:**
- Pretty `.test` domains (`aigon.test`, `cc-69.aigon.test`)
- HTTPS (Caddy auto-generates certificates)

**What is gained:**
- No root processes (dnsmasq, Caddy both require root or elevated privileges)
- No `/etc/resolver/test` file
- No setup ceremony (`aigon radar` just works after `npm install`)
- No Caddyfile generation/reload cycle
- No failure mode from stale Caddyfile or dead Caddy process
- No dnsmasq failure mode (DNS resolution breaks, affecting all `.test` domains system-wide)

**Assessment**: The `.test` domains are cosmetic. For a single-user local dev tool, `localhost:4100` is equivalent. No security policies (CORS, cookies) break — the dashboard only talks to its own origin. HTTPS is unnecessary for localhost.

### Q5: Can the WebSocket terminal relay be removed?

**Yes. Three replacement options, in order of simplicity:**

**Option A (recommended): "Open in Terminal" links**
- Replace the in-browser terminal with a button/link that runs `tmux attach -t <session>` in the user's actual terminal
- iTerm2 supports URL schemes: `iterm2:/command?c=tmux%20attach%20-t%20session-name`
- The dashboard already has "Copy slash command" buttons — extend this to "Open in Terminal"
- This eliminates: xterm.js (3 CDN scripts), WebSocket handshake code, `tmux pipe-pane` relay, `/tmp/aigon-term-*.txt` temp files, ~450 lines of code total
- Trade-off: No terminal in the browser. But the terminal in the browser was the #1 source of fragility

**Option B: ttyd sidecar**
- [ttyd](https://github.com/tsl0922/ttyd) is a battle-tested C tool for sharing terminals over HTTP. Run `ttyd -p 7681 tmux attach -t session` and iframe/link to it
- More reliable than hand-rolled relay, but adds an external dependency

**Option C: Keep WebSocket, use WeTTY**
- [WeTTY](https://github.com/butlerx/wetty) is a Node.js web terminal with proper reconnection, sizing, and auth
- Less code to maintain than the custom relay, but still a WebSocket-based subsystem

**Assessment**: Option A is the radical simplification. The terminal relay exists because "wouldn't it be cool to see terminal output in the dashboard?" but in practice the user always has a terminal open. The dashboard should trigger actions and show status, not be a terminal emulator.

### Q6: Can the dashboard work without a long-running daemon?

**Yes. Two viable models:**

**Model A (recommended): On-demand server with auto-shutdown**
- `aigon radar` starts an HTTP server in the foreground, opens the browser, sets an idle timer
- Every HTTP request resets the timer. After 5 minutes of no requests, the server shuts down
- No PID files, no stale daemons, no `radar stop` command needed
- Implementation is ~15 lines (idle timer + `server.close()` + `server.closeIdleConnections()` from Node 18.2+)
- Trade-off: User must re-run `aigon radar` if they close the tab and come back later. But `aigon radar` is already the command they run — no behavior change

**Model B: Stateless CGI-like server**
- A minimal HTTP server serves static HTML. Each `/api/*` request spawns `aigon` CLI as a child process
- Server has zero in-memory state — can be killed/restarted freely
- Trade-off: ~100-300ms overhead per CLI spawn. Mitigated by a single `aigon radar --json-all` that returns everything in one call
- Could combine with Model A (on-demand + stateless)

**Model C (considered, rejected): Static HTML generation**
- `aigon radar --snapshot` generates a self-contained HTML file with data baked in
- No live updates. Must re-run CLI to refresh. Too manual for a status dashboard

**Model D (considered, rejected): macOS launchd socket activation**
- launchd starts the Node.js process when a connection arrives on port 4100
- macOS-only, painful debugging, adds `node-socket-activation` native dependency
- Overkill for this use case

**Assessment**: Model A (on-demand with auto-shutdown) is the sweet spot. It eliminates daemon management entirely while keeping live polling. The server is ephemeral — there's nothing to get stale.

### Q7: What does a minimal but reliable dashboard look like?

**The minimal trusted surface:**

1. **Monitor view** — Feature cards with agent status dots, timestamps, and action buttons. This is what the user looks at 80% of the time
2. **Pipeline board** — Kanban drag-drop for moving features between stages. Used when triaging or planning
3. **Action execution** — Buttons that POST to `/api/action` which runs CLI commands. The source of truth for valid actions is the state machine (already exists)
4. **Spec drawer** — Read/edit spec files inline. Used when reviewing or creating features

**What can be deferred or removed:**
- **Analytics/Statistics**: Nice to have but low-frequency. Could be a separate `aigon stats` CLI command
- **Logs view**: Searchable table of historical features. Low-frequency, could be CLI
- **Settings view**: Repo management. Rarely used, could be CLI-only
- **Terminal panel**: Replace with "open in terminal" as discussed above
- **Sessions view**: List/kill tmux sessions. Useful but could be CLI (`aigon sessions`)

**Architecture**: A single HTML file is fine for development, but consider Alpine.js for incremental organization. Alpine decorates existing HTML with `x-data`, `x-for`, `x-show` attributes — no rewrite needed, just sprinkle directives onto the existing markup. This replaces the 90+ vanilla JS render functions with declarative bindings.

### Q8: Should menubar and VS Code extension be retired?

**Menubar app (SwiftBar plugin):**
- A bash shell script at `~/.swiftbar/aigon.30s.sh`
- Displays feature/agent status in macOS menu bar, refreshes every 30s
- Has known regressions: "Needs Attention" section body missing, click-to-focus broken in new radar version
- Duplicates: Monitor view status, attention alerts
- **Recommendation: Retire.** The dashboard provides the same information with more context. A browser tab pinned to the dashboard replaces the menubar's function

**VS Code extension:**
- `vscode-extension/extension.js` (~393 lines), sidebar tree view
- Provides: feature/agent status tree, right-click actions (ship, close, implement), attention alerts
- 10-second polling, file watchers for repo list changes
- Recently maintained (feature 33, March 2026)
- Duplicates: Monitor view, operator actions, attention alerts
- **Recommendation: Retire.** The extension provides a read-only subset of the dashboard. Right-click actions are available as CLI commands. The maintenance burden (separate codebase, VSIX packaging, VS Code API surface) is not justified by the incremental convenience

**Impact of retiring both:**
- No IDE-integrated status view (user opens dashboard in browser instead)
- No persistent menu bar indicator (user pins dashboard tab instead)
- Removes ~800 lines of code (extension + menubar generation in shared.js)
- Removes SwiftBar/xbar dependency and VSIX build/install process

### Q9: Migration path from current to simplified stack

**Phase 1 — Decouple (non-breaking):**
- Add `--foreground` flag to `aigon radar` that runs the server in foreground with auto-shutdown
- Add instance discovery files (`~/.aigon/instances/*.json`) alongside existing PID/registry
- Namespace localStorage keys by instance in the dashboard
- Both old (daemon + Caddy) and new (foreground + ports) modes work simultaneously

**Phase 2 — Simplify server (breaking for internals, transparent to user):**
- Remove WebSocket terminal relay, replace with "open in terminal" buttons
- Remove xterm.js CDN dependencies
- Remove Caddy/dnsmasq proxy code (Caddyfile generation, registry, reload)
- Make foreground mode the default; remove daemon/PID code

**Phase 3 — Simplify dashboard (incremental):**
- Adopt Alpine.js for declarative rendering
- Split the monolithic render functions into Alpine components
- Remove analytics/logs/settings views from the dashboard (move to CLI)
- The dashboard becomes: Monitor + Pipeline + Spec drawer + Actions

**Phase 4 — Retire companions:**
- Remove menubar plugin generation code from shared.js
- Remove VS Code extension directory and install logic
- Update documentation

## Sources

**Architecture & Multi-Instance:**
- [Portree — Git Worktree Server Manager](https://github.com/fairy-pitta/portree) — deterministic port hashing for worktrees
- [Jupyter Runtime Files](https://docs.jupyter.org/en/latest/running.html) — discovery file pattern
- [detect-port (npm)](https://github.com/node-modules/detect-port) — port availability checking
- [Vite port auto-increment](https://github.com/vitejs/vite/issues/7271) — how Vite handles port conflicts
- [MDN Same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy) — localhost port isolation
- [Cookies on localhost (DEV Community)](https://dev.to/woovi/best-dx-for-cookies-on-localhost-51bp) — localStorage/cookie sharing across ports

**Daemon Alternatives:**
- [Node.js HTTP server.closeIdleConnections()](https://nodejs.org/api/http.html) — clean shutdown for idle servers
- [http-graceful-shutdown (npm)](https://www.npmjs.com/package/http-graceful-shutdown) — graceful shutdown patterns
- [Apple launchd Documentation](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html) — socket activation (evaluated and rejected)

**Terminal Alternatives:**
- [ttyd — Share terminal over the web](https://github.com/tsl0922/ttyd) — battle-tested terminal sharing
- [WeTTY — Web Terminal](https://github.com/butlerx/wetty) — Node.js web terminal
- [iTerm2 URL Schemes](https://iterm2.com/documentation-command-selection.html) — deep-link to terminal sessions

**Dashboard Frameworks:**
- [Alpine.js](https://alpinejs.dev/) — HTML-first declarative framework, no build step
- [Preact + HTM](https://preactjs.com/guide/v10/no-build-workflows/) — React-like without build
- [Petite-vue (abandoned)](https://github.com/vuejs/petite-vue/discussions/225) — evaluated and rejected
- [Prometheus Web UI](https://github.com/prometheus/prometheus/blob/main/web/ui/README.md) — React SPA compiled into binary
- [Traefik Dashboard](https://doc.traefik.io/traefik/operations/dashboard/) — Vue SPA compiled into binary

**Testing:**
- [Playwright Mock APIs](https://playwright.dev/docs/mock) — `page.route()` for intercepting fetch
- [Playwright Visual Testing](https://blog.scottlogic.com/2025/02/12/playwright-visual-testing.html)

**Data Transport:**
- [SSE vs WebSockets vs Polling (AlgoMaster)](https://blog.algomaster.io/p/polling-vs-long-polling-vs-sse-vs-websockets-webhooks) — polling is correct for low-frequency dashboards

## Recommendation

**Replace the current daemon+proxy+relay stack with an on-demand foreground server and port-per-instance model.**

The architecture:
1. `aigon radar` starts an HTTP server in foreground on port 4100 (main) or auto-allocated port (worktree), opens the browser, auto-shuts down after 5 min idle
2. No Caddy, no dnsmasq, no proxy. Just `localhost:PORT`
3. No WebSocket terminal relay. Dashboard triggers actions via POST, terminal sessions open in the real terminal via `tmux attach`
4. Dashboard polls `/api/status` every 10 seconds (keep current approach — polling is correct at this scale)
5. Instance discovery via `~/.aigon/instances/*.json` files, enabling `aigon radar list` and `aigon radar open <name>`
6. Retire menubar app and VS Code extension — dashboard is the single UI surface
7. Incrementally adopt Alpine.js to organize the dashboard HTML without a build step

This removes: daemon management (PID files, background process, stale daemons), Caddy reverse proxy (Caddyfile, reload, root access), dnsmasq (DNS resolution, `/etc/resolver/test`), WebSocket terminal relay (xterm.js, pipe-pane, temp files), menubar app (SwiftBar plugin), VS Code extension (sidebar, VSIX packaging).

This keeps: all operator actions, status visibility, pipeline board, spec editing, polling-based updates, single-file dashboard HTML.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| radar-foreground-server | Replace daemon with foreground HTTP server that auto-shuts down after 5 min idle | high | none |
| radar-port-per-instance | Auto-allocate ports per worktree with discovery files at `~/.aigon/instances/*.json` | high | radar-foreground-server |
| radar-remove-proxy | Remove Caddy/dnsmasq proxy stack, Caddyfile generation, and server registry | high | radar-port-per-instance |
| radar-remove-terminal-relay | Replace WebSocket terminal relay with "open in terminal" buttons, remove xterm.js | high | none |
| radar-remove-menubar | Retire SwiftBar menubar plugin and remove generation code from shared.js | medium | none |
| radar-remove-vscode-ext | Retire VS Code extension directory and remove install logic | medium | none |
| radar-dashboard-alpine | Incrementally adopt Alpine.js for declarative rendering in dashboard HTML | medium | radar-remove-terminal-relay |
| radar-dashboard-slim | Remove analytics/logs/settings views from dashboard, move to CLI commands | low | radar-dashboard-alpine |
| radar-playwright-tests | Add Playwright tests with `page.route()` mock data for dashboard visual regression | medium | radar-foreground-server |
