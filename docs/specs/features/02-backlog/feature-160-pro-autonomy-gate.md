# Feature: pro-autonomy-gate

## Summary

Gate unattended orchestration commands (`feature-autonomous-start`, `research-autopilot`, `feature-do --autonomous`) behind Pro availability. Extend `lib/pro.js` with a named-capability helper `assertProCapability(name, fallbackCmd)` so future Pro features can be gated via the same pattern. When a gated command is invoked without Pro, print a clear one-shot message naming the free fallback, set `process.exitCode = 1`, and return. No nagging, no retries, no destabilising side effects.

## Safety principle (non-negotiable)

**This feature must not make aigon less stable under any circumstance.** The existing `isProAvailable()` pattern is battle-tested at four call sites (`lib/dashboard-server.js`, `lib/dashboard-status-collector.js`, `lib/commands/misc.js`). This feature reuses that pattern — it does not invent new architecture. Every change is additive, every gate is a ~5 line `if (!assertProCapability(...)) return;` block, and each gate can be reverted individually. If any AC fails manual lifecycle testing, it is reverted, not patched.

## User Stories

- [ ] As a free user, I can run all interactive / Drive mode commands without restriction
- [ ] As a free user invoking `feature-autonomous-start`, I see a single clear message explaining the Pro gate and the exact free fallback (`feature-start` + `feature-do`)
- [ ] As a Pro user (or a dev with `forcePro: true` set), `feature-autonomous-start`, `research-autopilot`, and `feature-do --autonomous` run exactly as they do today — zero behaviour change
- [ ] As a user with a currently-running autonomous loop, I can always observe it with `feature-autonomous-start status` and stop it with `feature-autonomous-start stop`, regardless of Pro state
- [ ] As a dev running the test suite without `@aigon/pro` installed, the existing tests continue to pass — the gate does not silently break autonomous-command tests

## Acceptance Criteria

### Core gating behaviour

- [ ] **AC1** — `feature-autonomous-start <id> <agents...>` (user-facing entry) is blocked when `isProAvailable()` is false; prints a gate message and exits non-zero
- [ ] **AC2** — `research-autopilot <id> [agents...]` is blocked when `isProAvailable()` is false; same behaviour
- [ ] **AC3** — `feature-do --autonomous` (Ralph retry loop) is blocked when `isProAvailable()` is false; same behaviour. Gate check runs **before** `runRalphCommand(args)` is invoked at `lib/commands/feature.js:~L1060`
- [ ] **AC4** — `lib/pro.js` exports `assertProCapability(capabilityName, fallbackCmd)` alongside the existing `isProAvailable()` / `getPro()` exports
- [ ] **AC5** — All Drive mode, manual Fleet, dashboard, and interactive commands remain ungated (`feature-start`, `feature-do` without `--autonomous`, `feature-eval`, `feature-review`, `feature-close`, `research-start`, `research-do`, etc.)
- [ ] **AC6** — Gate check runs at command entry points inside `lib/commands/feature.js` and `lib/commands/research.js`, **never** in `lib/worktree.js`, `lib/validation.js`, `lib/workflow-core/`, or any shared plumbing
- [ ] **AC7** — Dashboard exposes `proAvailable` through `lib/dashboard-status-collector.js` (already does at line ~771) so the frontend can render a "Pro" marker on the autonomous-start button for free users. Frontend treatment is tracked in `pro-autonomy-bundle` (159), not here — this feature only ensures the data is available to it

### Subcommand scope (critical for stability)

- [ ] **AC8** — Only the user-facing **start** invocation of `feature-autonomous-start` is gated. The following subcommands **remain ungated**:
    - `feature-autonomous-start __run-loop <id>` — internal, called by the detached tmux worker. Gating this would kill in-flight runs whose Pro status flipped mid-loop, leaving half-baked worktrees and corrupt workflow state
    - `feature-autonomous-start status <id>` — read-only observation. Users must always be able to see what's happening
    - `feature-autonomous-start stop <id>` — halt a running loop. Users must always be able to stop what's running regardless of Pro state
- [ ] **AC8b** — Equivalent subcommand-scoping applies to `research-autopilot`: only the start invocation is gated. `research-autopilot status` and `research-autopilot stop` remain ungated

### Contract of `assertProCapability()`

- [ ] **AC9** — `assertProCapability(name, fallbackCmd)` **returns a boolean**, never throws, and never calls `process.exit()` from inside the function. Messaging is printed as a side effect on the `false` path. Callers decide the exit path (`if (!assertProCapability(...)) { process.exitCode = 1; return; }`). This matches the contract of `isProAvailable()` exactly.
- [ ] **AC9b** — On `false`, the function prints exactly one block: capability name, free fallback command, and the upgrade link. No repeated prints, no retries, no nagging.

### Dashboard coverage

- [ ] **AC10** — Dashboard autonomous-start endpoint (`lib/dashboard-server.js:~L1560`) is automatically covered by the CLI gate because it spawns the CLI via `spawnSync(process.execPath, [CLI_ENTRY_PATH, ...args])` rather than calling a library function. Verified by a manual test: hit the `POST /api/repos/:repo/features/:id/autonomous-start` endpoint with `forcePro: false` set in the repo's `.aigon/config.json`, assert the response contains the gate message and a non-zero exit code
- [ ] **AC10b** — Frontend treatment of the gate (greying out the button, showing a `[Pro]` badge) is **out of scope** for this feature — it belongs in `pro-autonomy-bundle` (159). This feature only guarantees the backend gate is enforced.

### Test-suite safety

- [ ] **AC11** — Before implementing any gate, audit `tests/` for any test that exercises `feature-autonomous-start`, `feature-do --autonomous`, or `research-autopilot`. Each affected test file must either:
    1. Set `forcePro: true` in its test project config so the gate passes through, **or**
    2. Override `ctx.pro.isProAvailable: () => true` via `buildCtx()` so the gate is bypassed at the library level
- [ ] **AC11b** — After implementing all gates, the full `npm test` suite passes in both states:
    - **Without `@aigon/pro` installed** and without `forcePro: true` (simulating a fresh OSS install) → tests of ungated commands pass, tests of gated commands see the gate (and handle it via AC11)
    - **With `forcePro: true` set globally** → all tests including gated-command tests pass identically to current behaviour

### Messaging quality

- [ ] **AC12** — Gate messaging is shown **exactly once** per invocation. No retry loops, no re-prints, no nag pattern across sessions. The function returns on first `false`; callers return immediately.
- [ ] **AC12b** — Messaging format is consistent across all three gated commands:
    ```
    🔒 Autonomous orchestration is a Pro feature.
       Free alternative: <exact fallback command>
       Learn more: https://aigon.build/pro
    ```

### Shipping discipline

- [ ] **AC13** — Ship in **five atomic commits**, each independently revertable, each passing `node -c aigon-cli.js && node -c lib/pro.js && npm test` on its own:
    1. **Commit 1** — Add `assertProCapability()` to `lib/pro.js`. Export it. Zero call sites. Zero behaviour change. This commit alone must be shippable and pass all tests.
    2. **Commit 2** — Test-suite audit + `forcePro: true` fixture updates. Still zero behaviour change; this is purely test plumbing to prepare for the gates in commits 3-5. Tests pass unchanged.
    3. **Commit 3** — Gate `feature-autonomous-start` user entry at `lib/commands/feature.js:~L2713`. Manual test: gate fires without Pro, passes with `forcePro: true`. Verify `__run-loop`, `status`, and `stop` subcommands remain ungated.
    4. **Commit 4** — Gate `feature-do --autonomous` at `lib/commands/feature.js:~L1060` (before `runRalphCommand` call). Manual test: `feature-do 42` still works, `feature-do 42 --autonomous` is gated.
    5. **Commit 5** — Gate `research-autopilot` user entry at `lib/commands/research.js:~L644`. Manual test: `research-start`/`research-do` still work, `research-autopilot` is gated. `research-autopilot status` and `research-autopilot stop` remain ungated.

## Validation

```bash
# Syntax + library checks
node -c aigon-cli.js
node -c lib/pro.js
node -c lib/commands/feature.js
node -c lib/commands/research.js

# Test suite — must pass after every commit in the 5-commit sequence
npm test

# Manual gate smoke (after commits 3-5 land)
# In a scratch repo with no @aigon/pro installed:
aigon feature-start 1 cc                              # expect: works
aigon feature-do 1                                    # expect: works
aigon feature-do 1 --autonomous                       # expect: gated
aigon feature-autonomous-start 1 cc                   # expect: gated
aigon feature-autonomous-start status 1               # expect: works (ungated read)
aigon feature-autonomous-start stop 1                 # expect: works (ungated stop)
aigon research-start 1 cc                             # expect: works
aigon research-autopilot 1 cc                         # expect: gated
aigon research-autopilot status 1                     # expect: works (ungated read)

# Dev override smoke
echo '{ "forcePro": true }' > .aigon/config.json
aigon feature-autonomous-start 1 cc                   # expect: proceeds normally
rm .aigon/config.json                                 # restore fresh state
```

## Technical Approach

### Where things live today

- `lib/pro.js` (~25 lines) — `isProAvailable()` reads `forcePro` from project config with a try/catch, returns `!!require('@aigon/pro')`. Used by `dashboard-server.js`, `dashboard-status-collector.js`, `commands/misc.js`
- `lib/commands/feature.js:2282` — `feature-autonomous-start` command factory. Four dispatch branches: `__run-loop`, `status`, `stop`, user-facing start (line ~2713)
- `lib/commands/feature.js:1060` — `feature-do` checks `--autonomous` / `--ralph`, delegates to `runRalphCommand(args)` if set
- `lib/commands/research.js:597` — `research-autopilot` command factory. Similar subcommand structure
- `lib/dashboard-server.js:1560` — HTTP endpoint spawns `aigon feature-autonomous-start ...` as a subprocess, so the CLI gate covers it automatically

### The new function (Commit 1)

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

No throws, no `process.exit()`, no state, no I/O beyond `console.log`. Idempotent. Safe to call from any context.

### Gate call-site shape (Commits 3-5)

Identical at every call site:

```js
const { assertProCapability } = require('../pro');
// ...
if (!assertProCapability('Autonomous orchestration', 'aigon feature-start <id>')) {
    process.exitCode = 1;
    return;
}
```

Five lines per gate. Three gates. Fifteen lines of new code total across commands/feature.js and commands/research.js.

### What is NOT changing

- `lib/pro.js:isProAvailable()` — unchanged
- `lib/pro.js:getPro()` — unchanged
- `lib/pro-bridge.js` (feature 219) — unchanged; the bridge is for pro-side route registration, not capability gating. This feature does not extend the bridge.
- The `forcePro` config override at `lib/pro.js:13-17` — unchanged; used as the test/dev override mechanism
- Any existing `isProAvailable()` call site — unchanged
- `lib/dashboard-server.js` — unchanged; the existing `spawnSync` launch path carries the gate through automatically
- `lib/workflow-core/` — unchanged; no engine state changes
- `lib/worktree.js`, `lib/validation.js`, `lib/commands/infra.js` — unchanged; gates live at command-entry layer only

### Testing strategy

Before any gate lands, audit `tests/` for test files that execute any of:
- `feature-autonomous-start`
- `feature-do --autonomous` / `feature-do --ralph`
- `research-autopilot`

For each affected file, add `forcePro: true` to the test project config fixture, OR override `ctx.pro` in the test's `buildCtx()` call. Whichever is cleaner for that test's shape.

Manual lifecycle tests after each commit in the 5-commit sequence:

1. `aigon feature-start 1 cc` → passes
2. `aigon feature-do 1` → passes
3. `aigon feature-close 1` → passes
4. `aigon feature-autonomous-start 1 cc` → gated (commits 3+) or passes (commits 1-2)
5. `aigon feature-autonomous-start status 1` → passes at every commit
6. `aigon feature-autonomous-start stop 1` → passes at every commit

If any manual test regresses, the last commit is reverted before moving on.

## Dependencies

- None — `lib/pro.js` already exists and already has the `forcePro` override mechanism. The 219 Pro bridge is not needed for capability gating (it's for route registration).

## Out of Scope

- **Usage-based metering / trial allowance** — see `pro-autonomy-metering` (deferred to inbox)
- **Bundle definition and framing** — see `pro-autonomy-bundle` (159)
- **Pricing, licensing, billing, checkout** — see `pro-licensing-and-billing` (deferred to inbox)
- **Frontend rendering of the gate** — button greying, `[Pro]` badges, upgrade CTAs on the dashboard. These belong in 159. This feature only guarantees the backend gate is enforced.
- **Gating manual Fleet spawn** — `feature-start 42 cc gg` (multi-agent setup) stays free; Fleet mode requires human eval/close
- **Gating batch feature runs** — not applicable; no such command exists
- **Hiding `--autonomous` from `--help` output** — the flag stays visible; whether it gets a `[Pro]` suffix is a 159 concern
- **Auto-upgrade prompts or nag screens** — explicitly banned by AC12
- **Changes to `@aigon/pro` package** — this feature is purely in the OSS repo

## Open Questions

*All previous open questions resolved: no pricing, no `--help` hiding, no BYOK concerns — those belong in later features.*

## Related

- Research: `#23 autonomous-mode-as-pro`
- Feature 219 — `lib/pro-bridge.js` extension seam (not used here, but relevant context)
- Feature 159 — `pro-autonomy-bundle` (framing + frontend treatment; ships after 160)
- Prior art: `lib/commands/misc.js:500` — existing `aigon insights` Pro gate uses the same pattern this feature generalises
