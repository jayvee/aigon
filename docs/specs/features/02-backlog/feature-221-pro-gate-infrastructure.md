# Feature: pro-gate-infrastructure

## Summary

Add the `assertProCapability(name, fallbackCmd)` helper to `lib/pro.js` and prove it works by gating **one** command: `feature-autonomous-start`. Includes the test-suite audit to make sure gating doesn't break existing tests. This is the foundation for all future Pro gating — once this ships, extending the pattern to other commands (Ralph, research-autopilot) is trivial.

Supersedes the first half of the original `pro-autonomy-gate` feature (formerly ID 160). The Ralph + research-autopilot gates are split out to their own feature.

## Safety principle (non-negotiable)

**This feature must not make aigon less stable under any circumstance.** It reuses the existing `isProAvailable()` pattern — which is already in production at four call sites — and introduces one new call site. Every change is additive. If any AC fails manual lifecycle testing, it is reverted, not patched.

## User Stories

- [ ] As a free user, `feature-autonomous-start` prints a clear one-shot message naming the free fallback (`feature-start` + `feature-do`) and exits non-zero
- [ ] As a Pro user (or dev with `forcePro: true` set), `feature-autonomous-start` runs exactly as it does today
- [ ] As a user with a currently-running autonomous loop, I can always observe it with `feature-autonomous-start status` and stop it with `feature-autonomous-start stop`, regardless of Pro state
- [ ] As a dev running the test suite without `@aigon/pro` installed, existing tests continue to pass

## Acceptance Criteria

### The helper

- [ ] **AC1** — `lib/pro.js` exports a new `assertProCapability(capabilityName, fallbackCmd)` function alongside the existing `isProAvailable()` / `getPro()` exports
- [ ] **AC2** — `assertProCapability()` returns a boolean, never throws, and never calls `process.exit()` from inside. Messaging is printed as a side effect on the `false` path. Callers decide the exit path.
- [ ] **AC3** — On `false`, the function prints exactly one block: capability name, free fallback, and upgrade link. No retries, no nag loops.

### The one gate

- [ ] **AC4** — `feature-autonomous-start <id> <agents...>` (user-facing entry at `lib/commands/feature.js:~L2713`) is blocked when `isProAvailable()` is false. The gate check runs **after** subcommand dispatch so `__run-loop`, `status`, and `stop` paths are untouched.
- [ ] **AC5** — The following subcommands remain ungated:
    - `feature-autonomous-start __run-loop <id>` — internal worker; gating this would kill in-flight runs
    - `feature-autonomous-start status <id>` — read-only observation
    - `feature-autonomous-start stop <id>` — halt a running loop; must always work
- [ ] **AC6** — Dashboard autonomous-start endpoint (`lib/dashboard-server.js:~L1560`) is automatically covered because it spawns the CLI via `spawnSync(process.execPath, [CLI_ENTRY_PATH, ...args])` rather than calling a library function. Verified manually: hit the endpoint with `forcePro: false` set, assert the gate message appears in the response.

### Test-suite safety

- [ ] **AC7** — Audit `tests/` for any test that exercises `feature-autonomous-start`. Each affected file either sets `forcePro: true` in its test project config, or overrides `ctx.pro.isProAvailable` via `buildCtx()`.
- [ ] **AC8** — `npm test` passes in both states:
    - Without `@aigon/pro` installed and without `forcePro: true` set
    - With `forcePro: true` set globally
- [ ] **AC9** — All existing `isProAvailable()` call sites (`dashboard-server.js`, `dashboard-status-collector.js`, `commands/misc.js`) remain unchanged and unaffected.

### What this feature does NOT do

- [ ] **AC10** — `feature-do --autonomous` (Ralph retry loop) is **not** gated by this feature — see `pro-gate-ralph-and-autopilot` (follow-up feature)
- [ ] **AC11** — `research-autopilot` is **not** gated by this feature — see `pro-gate-ralph-and-autopilot`
- [ ] **AC12** — Frontend rendering (button greying, `[Pro]` badges) is **not** in scope — see `pro-autonomy-bundle` (159). This feature only guarantees the backend gate fires.

## Validation

```bash
# Syntax + library checks
node -c aigon-cli.js
node -c lib/pro.js
node -c lib/commands/feature.js

# Test suite
npm test

# Manual gate smoke — in a scratch repo with no @aigon/pro installed:
aigon feature-start 1 cc                              # expect: works (ungated)
aigon feature-do 1                                    # expect: works (ungated)
aigon feature-autonomous-start 1 cc                   # expect: GATED
aigon feature-autonomous-start status 1               # expect: works (ungated read)
aigon feature-autonomous-start stop 1                 # expect: works (ungated stop)

# Dev override smoke
echo '{ "forcePro": true }' > .aigon/config.json
aigon feature-autonomous-start 1 cc                   # expect: proceeds normally
rm .aigon/config.json
```

## Technical Approach

### The helper

```js
// lib/pro.js — appended to existing exports

function assertProCapability(capabilityName, fallbackCmd) {
    if (isProAvailable()) return true;
    console.log(`🔒 ${capabilityName} is a Pro feature.`);
    if (fallbackCmd) console.log(`   Free alternative: ${fallbackCmd}`);
    console.log('   Learn more: https://aigon.build/pro');
    return false;
}

module.exports = {
    isProAvailable,
    getPro: () => pro,
    assertProCapability,
};
```

### The gate call site

```js
// lib/commands/feature.js — at ~L2713, inside the user-facing start branch
// (AFTER __run-loop, status, stop subcommand dispatch)

const { assertProCapability } = require('../pro');
// ...
if (!assertProCapability('Autonomous orchestration', 'aigon feature-start <id> + aigon feature-do <id>')) {
    process.exitCode = 1;
    return;
}
```

Five new lines in `lib/pro.js`, five new lines in `lib/commands/feature.js`. That is the entire code surface.

### What is NOT changing

- `lib/pro.js:isProAvailable()` — unchanged
- `lib/pro.js:getPro()` — unchanged
- `lib/pro-bridge.js` — unchanged (route registration is orthogonal to capability gating)
- The `forcePro` config override at `lib/pro.js:13-17` — unchanged; used as the test/dev override
- Any existing `isProAvailable()` call site — unchanged
- `lib/dashboard-server.js` — unchanged; the `spawnSync` launch path carries the gate through automatically
- `lib/workflow-core/` — unchanged; no engine state changes
- `lib/worktree.js`, `lib/validation.js`, `lib/commands/infra.js` — unchanged

### Shipping discipline

Ship in three atomic commits:

1. **Commit 1** — Add `assertProCapability()` to `lib/pro.js`. Zero call sites. `npm test` passes unchanged.
2. **Commit 2** — Test-suite audit: add `forcePro: true` or ctx overrides to any test that exercises `feature-autonomous-start`. Still zero behaviour change. `npm test` passes.
3. **Commit 3** — Gate `feature-autonomous-start` user entry. Manual smoke test per the validation checklist. `npm test` passes.

Each commit is independently revertable.

## Dependencies

- None. `lib/pro.js` and `forcePro` override both already exist and are production-proven.

## Out of Scope

- `feature-do --autonomous` gating → `pro-gate-ralph-and-autopilot`
- `research-autopilot` gating → `pro-gate-ralph-and-autopilot`
- Frontend treatment (Pro badges, button greying) → `pro-autonomy-bundle` (159)
- Pricing, licensing, billing → `pro-licensing-and-billing` (inbox)
- Usage metering → `pro-autonomy-metering` (inbox)

## Open Questions

None — all resolved during the split from original 160.

## Related

- Prior art: `lib/commands/misc.js:500` — the existing `aigon insights` Pro gate uses this exact pattern
- Follow-up: `pro-gate-ralph-and-autopilot` — applies the proven pattern to the two remaining autonomous commands
- Feature 159 — `pro-autonomy-bundle` — frontend treatment, ships after this
- Feature 219 — `lib/pro-bridge.js` extension seam (not used here; route registration is orthogonal to capability gating)
