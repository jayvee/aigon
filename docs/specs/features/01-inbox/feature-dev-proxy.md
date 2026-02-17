# Feature: Local Dev Proxy with Subdomain Routing

**Supersedes:** feature-subdomain-configuration-for-bakeoff-mode.md

## Summary

Replace fragile port-based dev server management with a local reverse proxy (Caddy + dnsmasq) that gives every dev server instance a meaningful URL. Agents never need to know port numbers — they run `aigon dev-server start`, get a URL like `http://cc-119.farline.test`, and everything just works.

## Problem

Currently, each agent worktree gets a static port assignment (cc=3001, gg=3002, etc.) written to `.env.local`. This causes constant friction:

1. **Agents struggle with ports** — they forget to read `.env.local`, use the wrong port, or fail to start background processes correctly
2. **No multi-feature support** — if Claude Code works on features 119 AND 120 simultaneously, they both want port 3001
3. **No multi-app support** — two projects using aigon on the same machine can collide (both try 3001)
4. **Browser tab confusion** — `localhost:3001` vs `localhost:3002` is hard to distinguish
5. **E2E tests** — Playwright/Cypress need a stable base URL; port juggling breaks test configs

## URL Scheme

**Format:** `{agent}-{featureId}.{appId}.test`

| Scenario | URL |
|---|---|
| Claude on feature 119 of farline | `cc-119.farline.test` |
| Gemini on feature 119 of farline | `gg-119.farline.test` |
| Claude on feature 120 of farline | `cc-120.farline.test` |
| Claude on feature 5 of shopkeeper | `cc-5.shopkeeper.test` |
| Solo mode (feature branch, no worktree) | `cc-119.farline.test` (same scheme — agent + feature known from branch) |
| Main branch / general dev | `farline.test` (bare app domain) |
| E2E test target | `cc-119.farline.test` (stable, no port in URL) |

**Why `.test`:** IETF-reserved (RFC 6761) for testing. Won't conflict with real domains. Unlike `.localhost`, works system-wide on macOS (Safari, curl, Node fetch, everything).

**Why agent-first in subdomain:** It's what you see in the Warp tab, and it's shorter. `cc-119` reads naturally as "Claude's instance of feature 119".

## User Stories

- [ ] As a developer, I want each worktree's dev server to have a unique, memorable URL so I can easily identify which agent/feature I'm testing in browser tabs
- [ ] As a developer running multiple features in parallel, I want each dev server on a unique URL without port conflicts
- [ ] As a developer with multiple aigon projects, I want dev servers from different apps to coexist on the same machine
- [ ] As a developer, I want agents to start dev servers without needing to understand port configuration
- [ ] As a developer, I want a one-time setup that works across all projects
- [ ] As a developer running E2E tests, I want a stable base URL that doesn't depend on which port was available
- [ ] As a developer who hasn't set up the proxy, I want existing port-based behaviour to continue working

## Acceptance Criteria

### One-time setup command
- [ ] `aigon proxy-setup` installs/verifies Caddy and dnsmasq via Homebrew
- [ ] Configures dnsmasq to resolve `*.test` → `127.0.0.1`
- [ ] Creates `/etc/resolver/test` (requires sudo, with clear prompt)
- [ ] Starts both services via `brew services`
- [ ] Verifies setup works (`dig anything.test @127.0.0.1`)
- [ ] Idempotent — safe to run multiple times

### Dev server lifecycle
- [ ] `aigon dev-server start` auto-detects app ID, agent, feature ID from context (worktree path, branch name, `.aigon/config.json`)
- [ ] Allocates an available port dynamically (using `detect-port` or equivalent)
- [ ] Writes `PORT=<port>` to `.env.local`
- [ ] Registers in `~/.aigon/dev-proxy/servers.json`
- [ ] Regenerates `~/.aigon/dev-proxy/Caddyfile` from registry
- [ ] Reloads Caddy (`caddy reload`)
- [ ] Prints the URL: `Dev server: http://cc-119.farline.test`
- [ ] `aigon dev-server stop` deregisters and reloads Caddy
- [ ] `aigon dev-server list` shows all active servers with app, agent, feature, port, URL, PID
- [ ] `aigon dev-server gc` removes entries whose PID is no longer running

### App ID
- [ ] Read from `.aigon/config.json` `appId` field if set
- [ ] Fall back to `package.json` `name` field (sanitized for DNS)
- [ ] Fall back to git repo directory name
- [ ] `aigon config set appId farline` sets it explicitly
- [ ] Sanitization: lowercase, strip `@scope/`, replace non-alphanumeric with hyphens

### Solo mode (feature branch, no worktree)
- [ ] `aigon dev-server start` detects agent from current aigon session context
- [ ] Detects feature ID from branch name (`feature-119-...`)
- [ ] Registers as `cc-119.farline.test` (same scheme as worktree mode)
- [ ] If on main branch with no feature, registers as `farline.test` (bare app domain)

### E2E test integration
- [ ] `aigon dev-server url` outputs just the URL for the current context (for scripts: `BASE_URL=$(aigon dev-server url)`)
- [ ] E2E configs can use the proxy URL as a stable base — no port in the URL
- [ ] Proxy URLs work with Playwright, Cypress, and any HTTP client

### Template integration
- [ ] `WORKTREE_TEST_INSTRUCTIONS` updated to use `aigon dev-server start` when proxy is available
- [ ] `STOP_DEV_SERVER_STEP` updated to use `aigon dev-server stop`
- [ ] `AGENT_DEV_SERVER_NOTE` for Codex: dev-server start handles the PTY/background concern internally
- [ ] Agents see the URL in output, never a port number

### URL visibility across sessions
- [ ] `aigon feature-implement` CLI output prints the dev server URL prominently at startup
- [ ] `aigon dev-server list` can be run from any terminal to see all active URLs at a glance

### In-app dev banner
When multiple agents run side-by-side, browser tabs at `cc-119.farline.test` and `gg-119.farline.test` help, but once you're looking at the page itself it's easy to lose track. The app should show a visible banner identifying the agent, feature, and URL.

**Env vars in `.env.local`** (already written by `feature-setup`, renamed with `NEXT_PUBLIC_` prefix so Next.js exposes them to the browser):
```
NEXT_PUBLIC_AIGON_AGENT_NAME=Claude
NEXT_PUBLIC_AIGON_BANNER_COLOR=#3B82F6
NEXT_PUBLIC_AIGON_FEATURE_ID=119
NEXT_PUBLIC_AIGON_DEV_URL=http://cc-119.farline.test
```

**Distribution options** (in priority order):
- [ ] **npm package (`@aigon/dev-banner`)** — a zero-config React component. Add `<AigonDevBanner />` to your root layout once, renders only in development, reads env vars automatically. Styled with the agent's colour. Tree-shaken out of production builds.
- [ ] **Framework-agnostic script tag** — for non-React apps. A small inline `<script>` that injects a banner div. Could be added by aigon to the HTML template or served by middleware.
- [ ] **`aigon init` integration** (nice-to-have) — when setting up a web project, offer to add the banner component to the root layout

**Banner shows:** `🔵 Claude — Feature #119 — cc-119.farline.test` (coloured bar matching the agent's colour, pinned to top of viewport, dev-only)

### Fallback (no proxy)
- [ ] If Caddy is not installed/running, `aigon dev-server start` falls back to current behaviour (static port in `.env.local`, `localhost:<port>` URL)
- [ ] Warning printed: "Proxy not configured. Run `aigon proxy-setup` for subdomain routing."
- [ ] All existing port-based functionality continues unchanged

## Configuration Model

### What's global (machine prerequisite, like Node.js)

Caddy and dnsmasq are system services — one instance handles all projects. Installed once via `aigon proxy-setup`:
- dnsmasq resolves `*.test` → 127.0.0.1
- Caddy listens on :80, routes subdomains to backend ports
- Runtime state in `~/.aigon/dev-proxy/` (servers.json, generated Caddyfile)

### Which profiles get this

Only profiles with `devServer.enabled: true` — currently **web** and **api**. iOS, Android, library, and generic profiles have no dev server, so `devProxy` is not added and none of this applies. When `aigon init` detects a web or API project, it offers to configure `devProxy`. For other profiles, the section is simply absent.

### What's per-repo (checked into `.aigon/config.json`)

All application-specific dev server configuration lives in the repo so it's self-documenting and portable:

```json
{
  "profile": "web",
  "appId": "farline",
  "devProxy": {
    "command": "npm run dev",
    "healthCheck": "/api/health",
    "basePort": 3000
  }
}
```

| Field | Purpose | Default |
|---|---|---|
| `appId` | The app domain (`farline.test`) | `package.json` name or dirname |
| `devProxy.command` | How to start the dev server | `npm run dev` |
| `devProxy.healthCheck` | Path to verify server is up | `/` |
| `devProxy.basePort` | Preferred starting port for allocation | `3000` |

When someone clones the repo, `.aigon/config.json` tells them and their agents everything about how this app's dev server works. If they have the proxy installed, subdomain routing works automatically. If not, port-based fallback still works.

### What's runtime state (not checked in)

`~/.aigon/dev-proxy/servers.json` — which servers are currently running on this machine. This is ephemeral state, not configuration.

## Technical Approach

### Architecture

```
Browser: http://cc-119.farline.test
    ↓
dnsmasq: *.test → 127.0.0.1
    ↓
Caddy (:80): reverse_proxy → localhost:{dynamic-port}
    ↓
Next.js dev server (port allocated dynamically)
```

### Runtime registry: `~/.aigon/dev-proxy/servers.json`

Ephemeral state — tracks what's running now, not configuration:

```json
{
  "farline": {
    "cc-119": { "port": 3847, "worktree": "/path/to/worktree", "pid": 73524, "started": "2026-02-17T10:00:00Z" },
    "gg-119": { "port": 4201, "worktree": "/path/to/worktree", "pid": 73801, "started": "2026-02-17T10:05:00Z" }
  },
  "shopkeeper": {
    "cc-5": { "port": 5832, "worktree": "/path/to/worktree", "pid": 75000, "started": "2026-02-17T12:00:00Z" }
  }
}
```

### Generated Caddyfile: `~/.aigon/dev-proxy/Caddyfile`

Auto-generated from the registry on every `dev-server start/stop`:

```caddyfile
{
    auto_https off
}

# farline
cc-119.farline.test {
    reverse_proxy localhost:3847
}

gg-119.farline.test {
    reverse_proxy localhost:4201
}

# farline (main branch)
farline.test {
    reverse_proxy localhost:3000
}

# shopkeeper
cc-5.shopkeeper.test {
    reverse_proxy localhost:5832
}
```

### Port allocation

1. Read `devProxy.basePort` from repo's `.aigon/config.json` (default: 3000)
2. Try `basePort + agentOffset` (cc=+1, gg=+2, etc.) for predictability
3. If occupied, use `detect-port` to find next available
4. Write allocated port to worktree's `.env.local`
5. Register in runtime `servers.json`

### Implementation in aigon-cli.js

**New functions:**
- `isProxyAvailable()` — checks if Caddy is running (`caddy version` + port 2019 check)
- `getAppId()` — `.aigon/config.json` > `package.json` name > dirname
- `sanitizeForDns(name)` — lowercase, strip scope, replace invalid chars
- `allocatePort(preferred)` — find available port
- `registerDevServer(appId, serverId, port, worktree, pid)` — update registry + Caddyfile + reload
- `deregisterDevServer(appId, serverId)` — remove from registry + reload
- `generateCaddyfile(registry)` — render Caddyfile from registry
- `gcDevServers()` — remove entries with dead PIDs

**New commands:**
- `proxy-setup` — one-time machine setup (install Caddy + dnsmasq)
- `dev-server start [--port N]` — allocate port, register with proxy, print URL
- `dev-server stop [serverId]` — deregister from proxy
- `dev-server list` — show all active servers across all apps
- `dev-server gc` — clean up entries whose PID is dead
- `dev-server url` — print URL for current context (for scripting)

### What `aigon dev-server start` does (pseudocode)

```
1. Read devProxy config from .aigon/config.json
2. Detect context: appId (from config), agentId, featureId (from worktree/branch)
3. serverId = `${agentId}-${featureId}` (or empty for main branch → bare appId)
4. Check if proxy is available
5. If proxy:
   a. port = allocatePort(config.devProxy.basePort + agentOffset)
   b. Write PORT=<port> to .env.local
   c. Register in ~/.aigon/dev-proxy/servers.json
   d. Regenerate Caddyfile, reload Caddy
   e. Print: "Dev server: http://{serverId}.{appId}.test"
6. If no proxy (fallback):
   a. port = config.devProxy.basePort + agentOffset || 3000
   b. Write PORT=<port> to .env.local
   c. Print: "Dev server: http://localhost:{port}"
   d. Print: "💡 Run `aigon proxy-setup` for subdomain routing"
```

### Applying to existing repos

When `aigon init` or `aigon install-agent` runs in an existing repo:
- If `.aigon/config.json` doesn't have `devProxy`, add defaults based on profile detection
- If the proxy is available, print a one-liner showing the URL scheme that will be used
- Existing worktrees with static ports in `.env.local` continue working; on next `aigon dev-server start` they get registered with the proxy (lazy migration, no restart needed)

## Dependencies

**Machine prerequisites (via `aigon proxy-setup`):**
- Caddy (`brew install caddy`)
- dnsmasq (`brew install dnsmasq`)
- Homebrew (macOS)

**npm (bundled or inline equivalent):**
- `detect-port` — for dynamic port allocation (or inline equivalent using `net.createServer`)

## Out of Scope

- HTTPS / SSL certificates (document mkcert as optional future enhancement)
- Linux / Windows setup (macOS only for v1; document architecture for portability)
- Auto-starting the dev server process itself (`aigon dev-server start` registers the mapping; the agent still runs the dev server via `devProxy.command` separately)
- Reverse proxy for non-HTTP services (databases, WebSocket-only servers)
- Cloud/remote development environments

## Future Enhancements

- `aigon dev-server start --run` — start the process AND register in one command (uses `devProxy.command` from config)
- Auto-cleanup on `feature-done` / `feature-cleanup`
- Dashboard at `aigon.test` showing all running dev servers with links
- Linux support (systemd-resolved handles `*.localhost` natively, or dnsmasq)
- HTTPS via mkcert integration
- `devProxy.env` field in config for additional env vars the dev server needs

## Open Questions

- Should `aigon dev-server start` also start the actual dev server process, or just register the port mapping? (Starting it adds complexity around process management, especially in Codex. Keeping them separate is simpler — but `devProxy.command` in the config enables a future `--run` flag.)
- Should `feature-setup` automatically call `aigon dev-server start` for each worktree, or leave it for the agent to call during `feature-implement`?
- Should the `devProxy` config section be added automatically on `aigon init` for web/api profiles, or only when the user opts in?

## Related

- Supersedes: `feature-subdomain-configuration-for-bakeoff-mode.md` (moved to 05-paused; limited to arena mode, no proxy, no multi-app)
- Related: `feature-parallel-features.md` (multiple features per agent drives the need for unique URLs)
- Research: subdomains-for-multi-agent-mode
