# Implementation Log: Feature 12 - dev-proxy

## Plan

Implement local dev proxy with subdomain routing using Caddy + dnsmasq. Replace fragile port-based dev server management with meaningful URLs like `http://cc-119.farline.test`.

## Progress

### Implemented
1. Core helper functions: `sanitizeForDns`, `getAppId`, `isPortAvailable`, `allocatePort`, `isProxyAvailable`
2. Registry management: `loadProxyRegistry`, `saveProxyRegistry`, `generateCaddyfile`, `reloadCaddy`
3. Server lifecycle: `registerDevServer`, `deregisterDevServer`, `gcDevServers`, `detectDevServerContext`
4. `proxy-setup` command — installs/configures Caddy + dnsmasq via Homebrew
5. `dev-server` command with subcommands: `start`, `stop`, `list`, `gc`, `url`
6. Config model: `devProxy` section in `.aigon/config.json`, `NEXT_PUBLIC_` env vars for in-app banner
7. Template integration: `AGENT_DEV_SERVER_NOTE` placeholder, updated `STOP_DEV_SERVER_STEP`
8. Help text updated with Dev Server section

### Testing (on ~/src/when-swell)
- `aigon proxy-setup` — installs Caddy, dnsmasq, configures `/etc/resolver/test`
- `aigon dev-server start` — registers server, generates Caddyfile, prints URL
- `curl -I http://when-swell.test` — returns 200 OK via Caddy proxy
- Fallback mode (no proxy) works correctly with `localhost:<port>` URLs

## Decisions

1. **Caddyfile hostnames need `http://` prefix** — Without it, Caddy defaults to HTTPS on port 443 even with `auto_https off`. The `http://` prefix forces plain HTTP on port 80.

2. **Caddy runs via `sudo brew services`** — Port 80 requires root. `caddy start` without sudo can't bind. Using `sudo brew services start caddy` with a symlink from Homebrew's expected config path to our generated Caddyfile.

3. **`PORT=<port>` in dev-server start output** — `.env.local` files aren't auto-loaded into shell environment, so agents need `PORT=3000 npm run dev` rather than just `npm run dev`. The `dev-server start` command now prints the exact command to run.

4. **testInstructions updated** — Web/API profiles now tell agents to run `aigon dev-server start` first to get the URL and port, rather than assuming PORT is magically available from `.env.local`.

5. **`AGENT_DEV_SERVER_NOTE` as separate placeholder** — Can't nest placeholders inside `WORKTREE_TEST_INSTRUCTIONS` (single-pass template processing), so it's injected directly in `feature-implement.md`.
