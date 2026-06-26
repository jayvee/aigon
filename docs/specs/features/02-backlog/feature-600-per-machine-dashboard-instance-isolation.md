---
complexity: high
set: instance-isolation
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-26T00:57:19.993Z", actor: "cli/feature-prioritise" }
---

# Feature: per-machine dashboard instance isolation

## Summary
On a developer machine, multiple aigon processes routinely run at once: the
always-on dev dashboard (run from the main checkout), e2e fixtures, and anything
an agent spawns inside a worktree. Today they all reach for the same single
machine-wide identity — port `4100`, the `aigon.localhost` Caddy route, and the
`~/.aigon` profile — with no arbitration, so whoever starts last stomps the
others. The result is the dashboard "suddenly changing" and `aigon.localhost`
becoming unreachable mid-session. This feature makes instance identity explicit
and structural: the **primary** dashboard (the long-lived one for this machine)
owns the canonical identity, and every non-primary instance (worktree / e2e /
ephemeral) is forced into its own isolated identity so it can never bind the
primary port, rewrite the primary Caddy route, or kill the primary process.

This is the foundation for the rest of the `instance-isolation` set — the
worktree preview launcher (Scenario A) and sandboxed backend preview (Scenario
B) sit on top of it.

## User Stories
- [ ] As a developer building aigon, I am guaranteed that my running dev dashboard cannot be silently killed, taken over, or have its `aigon.localhost` route hijacked by a test run or by an agent working in a worktree.
- [ ] As a developer, when something other than my primary dashboard tries to start, it transparently isolates itself (own port + own subdomain + own profile) instead of colliding.
- [ ] As a maintainer, the existing `isE2eServer` special-cases become the *default* posture rather than opt-in guards I have to remember to wire into every call site.

## Acceptance Criteria
- [ ] Instance identity is derived from the workspace root path (primary checkout vs. worktree vs. ephemeral temp home), not from a single hardcoded constant. The primary dashboard keeps `aigon.localhost` : configured port.
- [ ] `getConfiguredServerPort()` (`lib/config.js:284`) actually resolves a per-instance port instead of unconditionally returning the hardcoded `DASHBOARD_DEFAULT_PORT`. Non-primary instances get a distinct, deterministic port (reuse the existing `hashBranchToPort` / 4101–4199 range).
- [ ] `getAigonServerAppId()` (`lib/proxy.js:98`) yields an instance-qualified Caddy host for non-primary instances (e.g. `<id>.aigon.localhost`) so a non-primary `server start` can never overwrite the primary `aigon.localhost` route.
- [ ] The "take over from existing server" path (`lib/commands/infra.js:1455`) cannot kill the primary dashboard from a non-primary instance. A non-primary `server start`/`restart` fails closed and self-isolates rather than calling `stopDashboardProcess` on the primary PID.
- [ ] The Caddy-route write fence (`proxyAvailable: !isE2eServer && isProxyAvailable()`, `infra.js:1477`/`1531`) is generalised: route writes are gated on "am I the primary instance for `aigon.localhost`", not on the `AIGON_E2E_SERVER` flag specifically.
- [ ] All four shared-state resources resolve consistently from one identity: `~/.aigon/ports.json` (`proxy.js:24`), `~/.aigon/dev-proxy/Caddyfile` (`proxy.js:18-20`), `~/.aigon/dashboard-runtime.json` (`global-config-migration.js:24`), and the bound port.
- [ ] Existing e2e isolation (temp `HOME`/`AIGON_HOME`, fixture ports 4200–4299) keeps working and is expressible as "just another non-primary instance" under the new model.

## Validation
```bash
```

## Technical Approach
The machinery for non-primary dashboards mostly already exists but is wired up
only for the *target repo's* worktree previews, not for aigon-developing-aigon:
`server-runtime.js:82-83` already hashes a worktree branch to a port, and
`buildCaddyHostname(appId, serverId)` (`proxy.js:325-327`) already produces
`<serverId>.<appId>.localhost`. The main `server start` path, however, hardcodes
`isWorktree: false` and the fixed `'aigon'` app-id (`infra.js:1466-1488`).

Approach: introduce a single "instance identity" resolver that, given the
current workspace root (cwd / `AIGON_HOME`), returns `{ profileHome, port,
caddyHost, isPrimary }`. Route `getConfiguredServerPort`, `getAigonServerAppId`,
the takeover check, and the Caddy-route fence through it. The primary is the
dashboard launched from the registered main checkout; everything else is
non-primary by construction. Note `os.homedir()` already honours a `HOME`
override (verified), and `getAigonHome()` is `AIGON_HOME || os.homedir()`, so the
profile-dir half of isolation already works — this feature closes the port +
hostname + takeover gaps that don't yet key off identity.

## Dependencies
- None — this is the base feature of the `instance-isolation` set.

## Out of Scope
- The user-facing `aigon preview <id>` command (separate feature in this set).
- The seeded sandbox profile for write-heavy backend changes (separate feature).
- Modelling a fully separate `production`/published channel — on this machine the
  published install only runs under Docker / on another machine, so it is at most
  a forward-compat consideration, not built or tested here.

## Open Questions
- How is the "primary checkout" determined — first instance to claim the
  `dashboard-runtime.json` lock, or an explicit registration of the main checkout
  path? (Leaning: primary = the dashboard started from the registered main repo
  root; later instances detect the live lock and self-isolate.)
- Should non-primary instances default to fully separate profile homes, or a
  namespaced sub-profile within `~/.aigon` keyed by instance id?

## Related
- Set: instance-isolation
- Prior features in set: <!-- this is the base feature; others depend on it -->
- Context: diagnosed alongside F594 (dashboard-e2e real-agent fence), which fenced
  agent *launches* to mock-only but did not address the `aigon.localhost` hijack /
  primary-server takeover described here.
