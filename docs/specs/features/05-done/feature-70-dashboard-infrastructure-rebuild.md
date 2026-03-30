# Feature: Dashboard Infrastructure Rebuild

## Summary

Replace the current AIGON server+proxy+relay stack with a simple foreground HTTP server. This eliminates: the daemon/PID model, Caddy reverse proxy, dnsmasq, the WebSocket terminal relay, the menubar SwiftBar plugin, and the VS Code extension. The command `aigon radar` is renamed `aigon dashboard`. The dashboard retains all interactive operator functionality (monitor, pipeline board, spec drawer, operator actions, analytics, logs) — only the fragile infrastructure underneath it is replaced. The dev loop constraint is solved first-class: production (main, port 4100) and development (worktree, auto-allocated port) instances run simultaneously without conflict.

## User Stories

- [ ] As a user, I run `aigon dashboard` and a browser tab opens immediately — no daemon to start first, no proxy setup, no root access required
- [ ] As a user developing Aigon itself, I can run `aigon dashboard` in a worktree on port 4101 while my production dashboard runs on 4100 — both show live data, neither conflicts with the other
- [ ] As a user clicking an action button in the dashboard, the action executes and the relevant agent session opens in my terminal — I don't need a working terminal embedded in the browser
- [ ] As a user, the dashboard works correctly after `npm install` with zero additional setup
- [ ] As an agent modifying dashboard code in a worktree, I can start `aigon dashboard` on the worktree port and verify my changes against real production data

## Acceptance Criteria

### Rename: radar → dashboard

- [ ] `aigon radar` command renamed to `aigon dashboard` throughout the CLI
- [ ] All subcommands updated: `aigon dashboard` (start+open), `aigon dashboard list` (show running instances), `aigon dashboard open [name]` (open browser for named instance)
- [ ] `aigon radar` kept as a deprecated alias that prints a warning and delegates to `aigon dashboard`
- [ ] All references to "radar" in log messages, config keys, and documentation updated to "dashboard"
- [ ] `RADAR_APP_ID`, `runRadarServiceDaemon`, `registerRadarServer` and related identifiers renamed

### Foreground server with auto-shutdown

- [ ] `aigon dashboard` starts an HTTP server in the foreground on the appropriate port, opens the browser, and exits after 5 minutes of no HTTP requests (idle timer resets on every request)
- [ ] No PID file written or read
- [ ] No background daemon spawned
- [ ] `aigon dashboard stop` subcommand removed (nothing to stop — Ctrl+C or idle shutdown)
- [ ] `aigon dashboard start` subcommand removed (replaced by `aigon dashboard`)
- [ ] Graceful shutdown: server closes idle connections on exit (`server.closeIdleConnections()`)

### Port-per-instance with discovery files

- [ ] Main repo instance always uses port 4100
- [ ] Worktree instances get a deterministic port derived from the branch name hash, in range 4101–4199, with `detect-port` fallback if occupied
- [ ] On startup, instance writes `~/.aigon/instances/<name>.json` containing `{ port, pid, worktreePath, startedAt }`
- [ ] On shutdown (clean or idle), instance removes its discovery file
- [ ] `aigon dashboard list` reads `~/.aigon/instances/` and shows all running instances with port and worktree path
- [ ] Dashboard localStorage keys namespaced by instance name (e.g. `aigon-main-selectedRepo`) to prevent cross-instance state pollution

### Remove Caddy/dnsmasq proxy

- [ ] `generateCaddyfile()`, `reloadCaddy()`, `loadProxyRegistry()`, `saveProxyRegistry()`, and all Caddyfile/dnsmasq code removed from `lib/utils.js`
- [ ] `aigon proxy-setup` command removed
- [ ] `aigon radar install` (launchd) command removed
- [ ] `~/.aigon/dev-proxy/` directory and its contents no longer created or referenced
- [ ] Dashboard served at `http://localhost:<port>` with no reverse proxy
- [ ] All `.test` domain references removed from code, templates, and documentation

### Remove WebSocket terminal relay

- [ ] WebSocket server removed from the HTTP server
- [ ] `tmux pipe-pane` relay code removed from `lib/utils.js` (approximately lines 3005–3137)
- [ ] xterm.js, FitAddon, and WebGL addon CDN `<script>` tags removed from `templates/dashboard/index.html`
- [ ] Client-side WebSocket and xterm.js initialisation code removed (~250 lines)
- [ ] Terminal panel in the dashboard UI replaced with an "Open in Terminal" button that POSTs to `/api/action` which calls `openTerminalAppWithCommand` (already exists in `lib/utils.js`) to attach the tmux session in the user's real terminal
- [ ] `/api/session/start` and `/ws/terminal` endpoints removed; `POST /api/action` and `POST /api/session/run` retained

### Retire menubar plugin

- [ ] SwiftBar/xbar plugin generation code removed from `lib/commands/shared.js`
- [ ] `aigon conductor menubar` (or equivalent) subcommand removed
- [ ] `~/.swiftbar/aigon.30s.sh` generation removed
- [ ] Documentation updated to remove menubar references

### Retire VS Code extension

- [ ] `vscode-extension/` directory removed
- [ ] `aigon install-agent` no longer installs or references the VS Code extension
- [ ] Extension-related code in `lib/commands/shared.js` removed
- [ ] Documentation updated

### Correctness

- [ ] `node -c aigon-cli.js && for f in lib/*.js lib/commands/*.js; do node -c "$f"; done` passes
- [ ] `npm test` passes (all existing tests)
- [ ] `aigon dashboard` opens browser at `http://localhost:4100`
- [ ] All dashboard operator actions (feature-setup, feature-do, feature-eval, feature-close, drag-drop pipeline) work correctly
- [ ] Monitor view, pipeline board, spec drawer, analytics, and logs view all render and function correctly
- [ ] Two simultaneous instances (e.g. port 4100 and 4101) run without conflict and show independent data
- [ ] `aigon dashboard list` correctly lists both instances

## Validation

```bash
node -c aigon-cli.js && for f in lib/*.js lib/commands/*.js; do node -c "$f"; done
npm test
# Start dashboard and verify it opens
node aigon-cli.js dashboard &
sleep 2
curl -s http://localhost:4100/api/status | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); JSON.parse(d); console.log('API OK')"
```

## Technical Approach

Work in order — each step leaves the system in a runnable state:

1. **Rename radar→dashboard** — find/replace command names, function names, config keys, log strings. Keep `aigon radar` alias. Run tests.
2. **Port-per-instance + discovery files** — add port allocation logic and `~/.aigon/instances/` read/write. No other changes yet.
3. **Foreground server** — strip daemon/PID/background-spawn code. Replace with foreground server + idle timer. Remove `start`/`stop` subcommands.
4. **Remove proxy** — delete Caddyfile/dnsmasq/registry code. Remove `proxy-setup` and `radar install` commands. Update all `aigon.test` URLs to `localhost:PORT`.
5. **Remove terminal relay** — delete WebSocket server, xterm.js scripts, pipe-pane code. Add "Open in Terminal" button and `/api/action` handler using `openTerminalAppWithCommand`.
6. **Retire companions** — delete `vscode-extension/`, remove menubar generation. Update `install-agent`.

The dashboard HTML (`templates/dashboard/index.html`) is read fresh on each request — frontend changes are visible immediately without restart. Backend changes require restarting the foreground process (Ctrl+C and re-run).

## Dependencies

- None — this is a standalone infrastructure replacement

## Out of Scope

- Alpine.js adoption (feature: dashboard-modernise)
- Playwright tests (feature: dashboard-modernise)
- New dashboard features or views
- The dev-server proxy stack (Caddy for `*.test` app domains — separate from radar, mostly works, not touched here)

## Related

- Research 11: radar-dashboard-radical-simplification
- Feature: dashboard-modernise (follow-on)
