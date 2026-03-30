# Feature: rebuild-server-launch-and-proxy

## Summary

The AIGON server launch, proxy, and URL system is unreliable. The launchd service uses `os.homedir()` as working directory (not a repo), causing `getAppId()` to derive wrong names (`jviner.localhost` instead of `aigon.localhost`). The proxy registry (`servers.json`) accumulates stale entries from dead processes. The `aigon server start` command behaves differently in foreground vs launchd vs tmux contexts. URLs are unpredictable. Rebuild the entire server launch and URL system from first principles — one clear design, one predictable URL, one reliable launch path.

## Current Problems

1. **WorkingDirectory in launchd plist is `os.homedir()`** — not a repo, so `getAppId()` returns `jviner` instead of `aigon`
2. **`getAppId()` derives the app name from `path.basename(cwd)`** — fragile, depends on where you start the server
3. **Proxy registry (`servers.json`) has stale entries** — dead processes leave orphan routes, causing wrong URLs
4. **Multiple competing URL sources** — proxy URL, direct `localhost:PORT`, launchd context, tmux context all produce different URLs
5. **`aigon server start` vs `aigon dashboard` vs launchd** — three different ways to start, each with different behaviour
6. **Worktree dashboard instances** — each worktree can spawn its own dashboard on a dynamic port, further polluting the registry
7. **No reconciliation on startup** — stale proxy entries from previous runs are never cleaned

## User Stories

- [ ] As an aigon user, `aigon server start` always starts the server and I can access it at one predictable URL
- [ ] As an aigon user, `aigon server start --persistent` installs auto-restart and the server comes back after reboot at the same URL
- [ ] As an aigon user, I never see `jviner.localhost` or `unknown.localhost` — the URL is always `aigon.localhost`
- [ ] As an aigon user, the server works identically whether started from terminal, launchd, or tmux

## Acceptance Criteria

- [ ] The AIGON server URL is always `aigon.localhost` regardless of which directory the server is started from
- [ ] `aigon server start` works from any directory — it does not depend on cwd being inside a specific repo
- [ ] `aigon server start --persistent` creates a launchd plist (macOS) / systemd unit (Linux) that uses the correct paths and produces the correct URL
- [ ] On startup, the server reconciles the proxy registry — removes stale entries from dead processes before registering itself
- [ ] The server registers itself with the proxy using a fixed app ID (`aigon`), not derived from cwd
- [ ] `aigon server status` shows the correct URL, PID, and uptime
- [ ] `aigon server stop` cleanly deregisters from the proxy and stops the process
- [ ] The proxy registry is not polluted by worktree dashboard instances (if worktree previews exist, they get their own isolated entries)
- [ ] The old `aigon dashboard` command is removed or becomes a thin alias to `aigon server`
- [ ] All documentation references `aigon server`, not `aigon dashboard`
- [ ] Works on macOS and Linux

## Validation

```bash
# From home directory (not a repo)
cd ~ && aigon server start &
curl -s http://aigon.localhost | head -1  # Should serve dashboard HTML

# From aigon repo
cd ~/src/aigon && aigon server start &
curl -s http://aigon.localhost | head -1  # Same URL, same result

# Persistent mode
aigon server start --persistent
# Reboot or kill process → verify it restarts at aigon.localhost
```

## Technical Approach

### Design principles

1. **The AIGON server has a fixed identity** — `aigon`, not derived from cwd. The app ID for proxy registration is always `aigon`.
2. **The server is repo-agnostic** — it reads registered repos from `~/.aigon/config.json`, not from cwd. Starting it from any directory produces the same result.
3. **One launch path** — `aigon server start` is the only way to start. It handles foreground, launchd, and systemd identically. The `dashboard` alias delegates to `server`.
4. **Clean startup** — on every start, reconcile the proxy registry before accepting requests. Remove stale entries, register self.
5. **Predictable URL** — always `aigon.localhost` (when proxy is available) or `localhost:4100` (without proxy).

### Implementation

1. **Fix `getAppId()` for server context** — when running as the AIGON server, use the fixed ID `aigon`, not `path.basename(cwd)`. The cwd-based ID remains for dev-server instances (project-specific).

2. **Fix `supervisor-service.js`** — launchd plist and systemd unit use `aigon` repo path as WorkingDirectory (resolved from `which aigon` or `ROOT_DIR`), not `os.homedir()`.

3. **Add startup reconciliation** — on server start, scan `servers.json`, remove entries whose PIDs are dead, then register self.

4. **Remove `aigon dashboard` as a separate command** — make it a one-line alias to `aigon server`. No separate code path.

5. **Update all docs and templates** — ensure `aigon server` is the only documented way to start the server.

## Dependencies

- None — this is infrastructure, can run anytime

## Out of Scope

- Rewriting the proxy itself (`lib/aigon-proxy.js` — that works fine)
- Changing the dashboard UI
- Changing the supervisor module
- Dev-server port allocation (separate concern, working)

## Open Questions

- Should worktree preview dashboards still exist, or should the main server serve all repos? (Currently each worktree can spawn its own)
- Should the proxy be required, or should `aigon server start` work without it (just `localhost:4100`)?

## Related

- Feature 172 (aigon server) — introduced the server concept
- `lib/supervisor-service.js` — launchd/systemd installer
- `lib/proxy.js` — proxy registry management
- `lib/dashboard-server.js` — the HTTP server
