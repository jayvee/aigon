# Feature: per-feature dev-server port allocation

## Summary

Currently dev-server ports are allocated per-agent (cc=base+1, gg=base+2, cx=base+3, etc.), meaning all features for a given agent share the same port. In Fleet mode, multiple features run in parallel for the same agent, causing EADDRINUSE crashes when a second feature's dev server tries to start. Fix: allocate ports per-feature-per-agent so multiple features can preview simultaneously.

## Current Behavior

- Port scheme: `basePort + agentOffset` (e.g., cx always gets 4203)
- Starting a dev server for feature 07 cx crashes if feature 02 cx is still running
- Proxy URLs are per-agent-per-feature (`cx-07.brewboard.localhost`) but ports aren't
- Temporary hack: kill-and-replace (kill existing server on port before starting)

## Acceptance Criteria

- [ ] Each feature+agent combination gets a unique port
- [ ] Multiple dev servers for the same agent (different features) can run simultaneously
- [ ] Proxy URLs continue to work (`{agent}-{featureId}.{repo}.localhost`)
- [ ] `aigon dev-server list` shows all running servers with their feature IDs
- [ ] `aigon dev-server stop` without args stops the current feature's server only
- [ ] Port allocation is deterministic (same feature+agent always gets same port)
- [ ] No EADDRINUSE crashes in Fleet mode

## Technical Approach

Options considered:
1. **Per-feature ports**: `base + (featureId * 10) + agentOffset` — deterministic but large port space
2. **Dynamic ports**: grab any free port — flexible, proxy URLs hide the port anyway
3. **Kill-and-replace**: only one server per agent at a time (current hack)

Recommended: Option 2 (dynamic ports) since proxy URLs already hide ports from the user.

Key files:
- `lib/commands/infra.js` — `dev-server start` port allocation
- `lib/proxy.js` — `allocatePort()`, `registerDevServer()`
- `lib/config.js` — `agentOffsets` definition

## Out of Scope

- Changing the proxy URL scheme
- Dev server for non-web profiles

## Related

- Kill-and-replace hack in `lib/commands/infra.js` (temporary, added as interim fix)
