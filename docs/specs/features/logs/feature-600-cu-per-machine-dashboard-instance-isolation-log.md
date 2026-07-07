# Implementation Log: Feature 600 - per-machine-dashboard-instance-isolation
Agent: cu

## Status
Implemented `lib/instance-identity.js` and routed server start/stop/restart, ports, Caddy hosts, and dashboard-runtime registry slots through it.

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: op
**Date**: 2026-07-07

### Fixes Applied
- None — implementation was clean

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- None

### Notes
- Identity axis (code root via realpath of `aigon-cli.js`) correctly decouples
  primary classification from cwd; mixed-invocation guard fails closed loudly and
  `--primary` override works as specified.
- `server start`/`stop`/`restart` now resolve `getServerRegistryEntry()` through
  identity-derived slot IDs, so a non-primary invocation reads/writes its own
  `dashboard-runtime-<id>.json` and cannot touch the primary's PID or slot.
  The takeover branch (`infra.js:1505`) is gated on `!identity.isEphemeral` and
  reads the caller's own slot, satisfying the "non-primary start can't kill
  primary" AC.
- Caddy route fence generalised from `!isE2eServer` to `!identity.isEphemeral`,
  and `ensureDashboardCaddyRoute` keys the hostname off `serverId`, so non-primary
  instances write `<id>.aigon.localhost` and never overwrite the primary route.
  `getAigonServerCaddyHost()` added to `lib/proxy.js` for the read side.
- `getConfiguredServerPort()` now routes through `resolveInstanceIdentity()`;
  circular lazy-require between config ↔ instance-identity ↔ proxy is safe (all
  cross-module requires are inside function bodies; tests pass).
- Registry path sanitisation in `getDashboardRuntimePath` correctly collapses
  non-`[a-zA-Z0-9._-]` runs to `-`, blocking path traversal via instance id.
- New integration test (`tests/integration/instance-identity.test.js`) covers
  worktree-is-non-primary, mixed-invocation fail-closed + `--primary` override,
  per-instance runtime path, and instance-qualified Caddy host. 4/4 pass.
- `static-guards.test.js` updated to assert the new identity-based fence. The
  one failing assertion in that file (`git add -A` in a `lib/feature-close.js`
  warning string) is pre-existing on `main` and unrelated to this branch — the
  implementer only touched the F600 Caddy-route assertion, not the `git add -A`
  test, and `lib/feature-close.js` is unchanged by this feature.
- Observation (not a fix): `getServerUrl(entry)` at `infra.js:1592` (status) and
  `:1663` (open) omit the `identity` arg and re-resolve it inside the helper.
  Functionally correct (identity is deterministic for the process), just
  slightly inconsistent with the `:1512` call site that passes it explicitly.
  Left alone — refactoring call sites is out of review scope.

