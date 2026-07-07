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
- [ ] Instance identity is derived from the **code root of the executing `aigon-cli.js`** (realpath-resolved, so the npm-linked global binary resolves into the main checkout), not from cwd and not from a single hardcoded constant. Classification: code root == the registered main checkout (or the global install on user machines) → **primary-eligible**; code root under `~/.aigon/worktrees/` → **worktree (non-primary)**; temp/overridden `AIGON_HOME` → **ephemeral (non-primary)**. Cwd must NOT be the axis: `aigon server start` run from any registered target repo via the global binary is still primary.
- [ ] Mixed-invocation case is decided and tested: primary-code `server start`/`restart` invoked with a **worktree cwd** (e.g. an agent inside an aigon worktree running the global `aigon server restart` per CLAUDE.md rule 3) does not silently kill/restart the primary — it either no-ops with a pointer to `aigon preview`, or requires an explicit `--primary` flag. Fail closed, loudly.
- [ ] `getConfiguredServerPort()` (`lib/config.js:284`) actually resolves a per-instance port instead of unconditionally returning the hardcoded `DASHBOARD_DEFAULT_PORT`. Non-primary instances get a distinct port (reuse the existing `hashBranchToPort` / 4101–4199 range). Note the hash can collide and fall back to `allocatePort` (`server-runtime.js:82-83`), so the **URL** (`<id>.aigon.localhost`) is the deterministic contract, not the port number.
- [ ] `getAigonServerAppId()` (`lib/proxy.js:98`) yields an instance-qualified Caddy host for non-primary instances (e.g. `<id>.aigon.localhost`) so a non-primary `server start` can never overwrite the primary `aigon.localhost` route.
- [ ] The "take over from existing server" path (`lib/commands/infra.js:1455`) cannot kill the primary dashboard from a non-primary instance. A non-primary `server start`/`restart` fails closed and self-isolates rather than calling `stopDashboardProcess` on the primary PID.
- [ ] **`server stop` is fenced too**: it currently stops whatever PID is in the registry unconditionally (`infra.js:~1495`). A non-primary invocation of `server stop` must never resolve to (and kill) the primary's PID — it stops only its own instance's entry. Audit every call site that resolves `getServerRegistryEntry()` into a kill.
- [ ] The Caddy-route write fence (`proxyAvailable: !isE2eServer && isProxyAvailable()`, `infra.js:1477`/`1531`) is generalised: route writes are gated on "am I the primary instance for `aigon.localhost`", not on the `AIGON_E2E_SERVER` flag specifically.
- [ ] **`~/.aigon/dashboard-runtime.json` is single-slot today** (`{pid, port}` per `AIGON_HOME`, `server-runtime.js:17-35`). Non-primary instances sharing the real `AIGON_HOME` (the F601 preview case) must never write the primary's slot — either the registry becomes multi-entry keyed by instance id, or non-primary instances register in per-instance runtime files. Without this, a preview registration clobbers the primary's entry and the next `server restart` kills the preview and orphans the primary.
- [ ] All four shared-state resources resolve consistently from one identity: `~/.aigon/ports.json` (`proxy.js:24`), `~/.aigon/dev-proxy/Caddyfile` (`proxy.js:18-20`), `~/.aigon/dashboard-runtime.json` (`global-config-migration.js:24`), and the bound port.
- [ ] Existing e2e isolation (temp `HOME`/`AIGON_HOME`, fixture ports 4200–4299) keeps working and is expressible as "just another non-primary instance" under the new model.

## Validation
```bash
node -c lib/config.js && node -c lib/proxy.js && node -c lib/server-runtime.js && node -c lib/commands/infra.js
npm run test:quick
# Primary survives a non-primary start: boot primary, then attempt `server start`
# from a worktree code root — assert primary PID unchanged, aigon.localhost route
# unchanged, and the second instance bound its own 41xx port + subdomain.
# Non-primary `server stop` must not kill the primary PID.
# Registry: after a non-primary start under the real AIGON_HOME, the primary's
# dashboard-runtime slot still holds the primary PID.
```

## Technical Approach
The machinery for non-primary dashboards mostly already exists but is wired up
only for the *target repo's* worktree previews, not for aigon-developing-aigon:
`server-runtime.js:82-83` already hashes a worktree branch to a port, and
`buildCaddyHostname(appId, serverId)` (`proxy.js:325-327`) already produces
`<serverId>.<appId>.localhost`. The main `server start` path, however, hardcodes
`isWorktree: false` and the fixed `'aigon'` app-id (`infra.js:1466-1488`).

Approach: introduce a single "instance identity" resolver that, given the
**code root of the running `aigon-cli.js`** (realpath of the entry script — the
npm-linked global binary realpaths into the main checkout, so "global install"
and "main checkout" are the same code root on a dev machine) plus the effective
`AIGON_HOME`, returns `{ profileHome, port, caddyHost, isPrimary, instanceId }`.
Cwd is deliberately not an input: the primary dashboard is legitimately started
from any registered target repo's directory. Route `getConfiguredServerPort`,
`getAigonServerAppId`, the takeover check, `server stop` resolution, and the
Caddy-route fence through it. The primary is the dashboard whose code root is
the registered main checkout; everything else is non-primary by construction.
Note `os.homedir()` already honours a `HOME` override (verified), and
`getAigonHome()` is `AIGON_HOME || os.homedir()`, so the profile-dir half of
isolation already works — this feature closes the port + hostname + takeover +
registry-slot gaps that don't yet key off identity.

Isolation is split in two halves, and the split is deliberate: the **identity
half** (bound port, Caddy host, runtime-registry slot) is always per-instance;
the **data half** (`~/.aigon` profile, registered repos, project state) is
shared by default so previews render real content (F601), and fully separated
only for ephemeral instances (e2e, F602 sandbox) via temp `AIGON_HOME`.

Forward-compat note: under this model a future published/npm-installed aigon is
just another code root — another non-primary instance that self-isolates — so
version isolation (running the released aigon alongside the dev checkout) falls
out of the same mechanism with no extra modelling; only the primary registration
decides which code root owns `aigon.localhost`.

## Dependencies
- None — this is the base feature of the `instance-isolation` set.

## Out of Scope
- The user-facing `aigon preview <id>` command (separate feature in this set).
- The seeded sandbox profile for write-heavy backend changes (separate feature).
- Modelling a fully separate `production`/published channel — on this machine the
  published install only runs under Docker / on another machine, so it is at most
  a forward-compat consideration, not built or tested here.

## Open Questions
- ~~How is the "primary checkout" determined?~~ **Resolved**: explicit
  registration — primary = the instance whose *code root* is the registered main
  checkout (realpath, so the npm-linked global binary qualifies). Not
  first-to-claim-lock (racey), and not cwd (misclassifies legit starts from
  target repos). Later instances with a different code root self-isolate by
  construction.
- ~~Fully separate profile homes vs. namespaced sub-profile?~~ **Resolved**:
  neither uniformly — split identity from data. Non-primary instances always get
  their own *identity* (port / caddy host / registry slot) but share the real
  `~/.aigon` *data* by default (required by F601's preview-real-data AC);
  ephemeral instances (e2e, F602 sandbox) get fully separate temp homes. A
  namespaced sub-profile satisfies neither case and is rejected.

## Related
- Set: instance-isolation
- Prior features in set: <!-- this is the base feature; others depend on it -->
- Context: diagnosed alongside F594 (dashboard-e2e real-agent fence), which fenced
  agent *launches* to mock-only but did not address the `aigon.localhost` hijack /
  primary-server takeover described here.
