# Feature: pro-gate-ralph-and-autopilot

## Summary

Apply the `assertProCapability()` helper from `pro-gate-infrastructure` to the remaining two unattended orchestration commands: `feature-do --autonomous` (Ralph retry loop) and `research-autopilot`. This is a pure extension — zero new infrastructure, zero new patterns. Each gate is five lines in the exact shape already proven by `pro-gate-infrastructure`.

## Safety principle (non-negotiable)

**This feature must not make aigon less stable under any circumstance.** It adds two new call sites to a helper that already has one production call site from `pro-gate-infrastructure`. Each gate is individually revertable. If any AC fails manual lifecycle testing, it is reverted, not patched.

## Prerequisites

- **Hard dependency**: `pro-gate-infrastructure` must be shipped first. This feature uses `assertProCapability()` which only exists after that feature lands.

## User Stories

- [ ] As a free user invoking `feature-do 42 --autonomous`, I see a clear message explaining the Pro gate and the free fallback (`feature-do 42` without the flag)
- [ ] As a free user invoking `aigon research-autopilot 3 cc`, I see a clear message naming the free fallback (`research-start 3 cc` + `research-do 3`)
- [ ] As a Pro user (or dev with `forcePro: true`), both commands run exactly as they do today
- [ ] As a user with a currently-running research-autopilot loop, I can always observe it with `research-autopilot status` and stop it with `research-autopilot stop`, regardless of Pro state

## Acceptance Criteria

### Ralph gate

- [ ] **AC1** — `feature-do <id> --autonomous` (and the `--ralph` alias) is blocked at `lib/commands/feature.js:~L1060` when `isProAvailable()` is false. The gate check runs **before** `runRalphCommand(args)` is invoked.
- [ ] **AC2** — `feature-do <id>` without `--autonomous` / `--ralph` remains ungated — only the Ralph loop is gated, not the interactive `feature-do` path.

### research-autopilot gate

- [ ] **AC3** — `research-autopilot <id> [agents...]` (user-facing entry at `lib/commands/research.js:~L644`) is blocked when `isProAvailable()` is false.
- [ ] **AC4** — `research-autopilot status <id>` and `research-autopilot stop <id>` remain **ungated**, matching the subcommand-scoping rule from `pro-gate-infrastructure`. Users must always be able to observe and halt running research loops regardless of Pro state.

### Consistency

- [ ] **AC5** — Gate messaging is consistent with `feature-autonomous-start` (same format, same emoji, same upgrade link)
- [ ] **AC6** — `research-start`, `research-do`, `research-review`, `research-eval`, `research-close` remain ungated — only the `research-autopilot` orchestration command is gated
- [ ] **AC7** — `npm test` passes in both "Pro missing" and "`forcePro: true`" states, identical to the requirement from `pro-gate-infrastructure`

### Test-suite safety

- [ ] **AC8** — Audit `tests/` for any test that exercises `feature-do --autonomous` or `research-autopilot`. Each affected file either sets `forcePro: true` in its test project config, or overrides `ctx.pro.isProAvailable` via `buildCtx()`.

## Validation

```bash
# Syntax checks
node -c aigon-cli.js
node -c lib/commands/feature.js
node -c lib/commands/research.js

# Test suite
npm test

# Manual gate smoke — in a scratch repo with no @aigon/pro installed:
aigon feature-do 1                                    # expect: works (ungated interactive)
aigon feature-do 1 --autonomous                       # expect: GATED
aigon feature-do 1 --ralph                            # expect: GATED (alias of --autonomous)
aigon research-start 1 cc                             # expect: works (ungated)
aigon research-do 1                                   # expect: works (ungated)
aigon research-autopilot 1 cc                         # expect: GATED
aigon research-autopilot status 1                     # expect: works (ungated read)
aigon research-autopilot stop 1                       # expect: works (ungated stop)

# Dev override smoke
echo '{ "forcePro": true }' > .aigon/config.json
aigon feature-do 1 --autonomous                       # expect: proceeds normally
aigon research-autopilot 1 cc                         # expect: proceeds normally
rm .aigon/config.json
```

## Technical Approach

Identical shape to `pro-gate-infrastructure`, applied at two more call sites.

### Ralph gate

```js
// lib/commands/feature.js — at ~L1060, inside the feature-do handler
// BEFORE the runRalphCommand(args) call

const ralphRequested = getOptionValue(options, 'autonomous') || getOptionValue(options, 'ralph');
if (ralphRequested) {
    if (!assertProCapability('Autonomous retry loop', 'aigon feature-do <id>')) {
        process.exitCode = 1;
        return;
    }
    return runRalphCommand(args);
}
```

### research-autopilot gate

```js
// lib/commands/research.js — at ~L644, inside the user-facing start branch
// (AFTER status/stop subcommand dispatch)

if (!assertProCapability('Research autopilot', 'aigon research-start <id> + aigon research-do <id>')) {
    process.exitCode = 1;
    return;
}
```

Ten lines of code total across both files.

### What is NOT changing

- `lib/pro.js` — unchanged (helper already added by `pro-gate-infrastructure`)
- `lib/pro-bridge.js` — unchanged
- `lib/commands/feature.js:feature-autonomous-start` — unchanged (already gated by `pro-gate-infrastructure`)
- `lib/dashboard-server.js` — unchanged; dashboard has no autopilot button today, and no Ralph button. If either is added later, it will spawn the CLI and inherit the gate automatically.
- `lib/workflow-core/` — unchanged
- `lib/validation.js` — unchanged (Ralph's loop implementation stays ungated; only the entry point gate matters)
- All other `isProAvailable()` call sites — unchanged

### Shipping discipline

Ship in two atomic commits:

1. **Commit 1** — Gate `feature-do --autonomous`. Manual smoke: `feature-do <id>` still works, `feature-do <id> --autonomous` is gated. `npm test` passes.
2. **Commit 2** — Gate `research-autopilot`. Manual smoke: `research-start`/`research-do` still work, `research-autopilot` is gated, `research-autopilot status`/`stop` still work. `npm test` passes.

Each commit is independently revertable.

## Dependencies

- **Hard**: `pro-gate-infrastructure` must be shipped first (provides `assertProCapability()`)

## Out of Scope

- Any new infrastructure (helper already exists from `pro-gate-infrastructure`)
- Frontend treatment → `pro-autonomy-bundle` (159)
- Metering, licensing, billing → separate features in inbox

## Open Questions

None.

## Related

- Prerequisite: `pro-gate-infrastructure` (the helper + first gate)
- Feature 159 — `pro-autonomy-bundle` — frontend treatment
- Prior art: `pro-gate-infrastructure` — same pattern, same messaging format
