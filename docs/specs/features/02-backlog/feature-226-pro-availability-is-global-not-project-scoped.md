# Feature: pro-availability-is-global-not-project-scoped

## Summary
`lib/pro.js:isProAvailable()` currently reads `forcePro` from **project** config (`<cwd>/.aigon/config.json`). That's architecturally wrong: Pro availability is a property of the aigon install, not of any individual repo. A paying user should see Pro features in every repo they work on; a free user should hit the gate everywhere. The per-repo override produces incoherent UX — during the 2026-04-06 manual test of the feature-221 Pro gate, flipping `forcePro: false` in brewboard caused the gate to fire when clicking "Start Autonomously" on a brewboard feature (subprocess runs with `cwd: ~/src/brewboard`) but the dashboard top-navigation "Insights PRO" tab **still showed as Pro-enabled** (dashboard server runs with `cwd: ~/src/aigon` where `forcePro: true`). Same user, same session, same click, different Pro state. This feature moves the override out of project config into an environment variable (`AIGON_FORCE_PRO`) — a naturally global, non-persistent, test-friendly mechanism — and deletes the concept of `forcePro` from project config entirely.

## Safety principle (non-negotiable)

**This refactor must not regress any currently-working behavior.** The Pro gate in `feature-221` must continue to fire correctly for OSS users; the `aigon insights` gate in `lib/commands/misc.js` must continue to fire correctly for OSS users; all existing tests must pass without modification to their assertion logic (only fixture/env setup changes). Feature 221's semantic contract ("Pro is gated behind `isProAvailable()` returning false") is preserved — only the **source** of the boolean changes.

## Motivation & current incoherence

Feature 221 codified the `forcePro` project-config mechanism in its AC6, AC7, AC11. This was a mistake — inherited from pre-219 code that read project config to avoid a circular require with `lib/config.js`. Nobody questioned whether project config was the right scope; they just used what was already wired.

The inconsistency surfaces in four places:

1. **Dashboard top nav**: `isProAvailable()` called by the dashboard server reads the server process's cwd (`~/src/aigon`). The Insights tab shows as Pro-enabled based on that.
2. **Autonomous-start button**: `isProAvailable()` called by a subprocess spawned with `cwd: <target-repo>` reads the *target* repo's config. Gate fires or doesn't based on whichever repo the feature belongs to.
3. **`aigon insights` CLI**: `isProAvailable()` called from wherever the user runs the command reads *that* cwd's config.
4. **Test suite**: the e2e tests set `forcePro: true` in their test project config to bypass the gate; mock-agent sets it in env for a different reason. Two different patterns, both leaking into project-config land.

None of these agree on "what counts as Pro for this user right now." They're computing the answer relative to four different cwds.

## User Stories

- [ ] As a user with Pro installed, every aigon command and dashboard tab shows the Pro state consistently regardless of which repo is current
- [ ] As an OSS user, every aigon command and dashboard tab shows the gate / free-tier state consistently regardless of which repo is current
- [ ] As a developer testing the gate, I can simulate OSS mode with `AIGON_FORCE_PRO=false aigon <command>` without modifying any config file
- [ ] As a developer launching the dashboard for an OSS demo, I can run `AIGON_FORCE_PRO=false aigon server start` and see gates fire consistently in both the top nav and the feature-action buttons
- [ ] As a test author, the e2e suite can set the Pro state via an env var on the dashboard process instead of writing a `forcePro` key into fixture project config

## Acceptance Criteria

### Core mechanism

- [ ] **AC1** — `lib/pro.js:isProAvailable()` reads the override from an environment variable (`AIGON_FORCE_PRO`) and **not** from project config. Accepted values: `"false"` / `"0"` → simulate free; `"true"` / `"1"` → no effect (Pro still requires the package); anything else / unset → no override.
- [ ] **AC2** — When `AIGON_FORCE_PRO` is unset, `isProAvailable()` returns `!!require('@aigon/pro')` (the current fallback behavior).
- [ ] **AC3** — `isProAvailable()` never reads project config. Remove the `loadProjectConfig()` import from `lib/pro.js` entirely.
- [ ] **AC4** — `isProAvailable()` still does not throw under any circumstances. All existing call sites keep working without modification.

### Delete `forcePro` from project config

- [ ] **AC5** — Remove `forcePro` from any `.aigon/config.json` files the team controls: the aigon repo itself, fixture configs in `tests/`, brewboard/trailhead seed configs, any committed example configs. This is a cleanup — `forcePro` should never have been a project-level concept.
- [ ] **AC6** — `lib/config.js` schema validation (if any) should warn when it sees `forcePro` in a project config, pointing to the env var. Soft warning only; don't break existing installs that may still have it.
- [ ] **AC7** — Update `CLAUDE.md` and `docs/architecture.md` to document `AIGON_FORCE_PRO` as the canonical override and explicitly say project config should not contain `forcePro`.

### Test-suite migration

- [ ] **AC8** — `tests/dashboard-e2e/setup.js` sets `AIGON_FORCE_PRO=true` in the `dashEnv` it passes to the spawned dashboard server. Every subprocess the dashboard spawns inherits this env (including the autonomous-start subprocess), so the whole session agrees on Pro state.
- [ ] **AC9** — `tests/integration/mock-agent.js` — already passes env overrides in `GIT_SAFE_ENV` and the submit-status invocation. Add `AIGON_FORCE_PRO: 'true'` to the same env block so MockAgent subprocesses never hit a gate.
- [ ] **AC10** — No test anywhere writes `forcePro` into a fixture project config file. Fixture project configs contain only real project-level settings.
- [ ] **AC11** — The full pre-push check passes unchanged: `npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh`.

### Retroactive correction of feature 221

- [ ] **AC12** — Append a note to `docs/specs/features/05-done/feature-221-pro-gate-infrastructure.md` (at the bottom, under a new `## Post-ship correction` heading) explaining that AC6/AC7/AC11 specified project-scope `forcePro` in error; the corrected mechanism is `AIGON_FORCE_PRO` env var per this feature. Do not edit the original ACs in place — the spec is a historical record of what 221 shipped, including its mistakes.

### Regression tests

- [ ] **AC13** — New unit test for `isProAvailable()` covering:
    - `AIGON_FORCE_PRO=false` → returns false even when `@aigon/pro` is mockable-installed
    - `AIGON_FORCE_PRO=true` → has no effect (real availability still gates)
    - `AIGON_FORCE_PRO` unset → falls back to package availability
    - `AIGON_FORCE_PRO="0"` → same as false
    - `AIGON_FORCE_PRO="1"` → same as true
    - `AIGON_FORCE_PRO="garbage"` → treated as unset / no override
- [ ] **AC14** — Regression comment names the incident: "prevents the 2026-04-06 Pro-gate incoherence bug where flipping forcePro in one repo's config produced different Pro states for different code paths in the same dashboard session."

## Validation

```bash
# Syntax
node -c lib/pro.js

# Unit tests
npm test

# E2E suite (also catches dashboard nav + autonomous-start paths)
MOCK_DELAY=fast npm run test:ui

# Budget
bash scripts/check-test-budget.sh

# Manual smoke — the incoherence bug that motivated this feature:
# 1. rm any forcePro from project configs
# 2. Start the dashboard with AIGON_FORCE_PRO=false aigon server start
# 3. Open the dashboard, switch to any repo
# 4. Click Insights → expect upgrade prompt (gate fires)
# 5. Click "Start Autonomously" on any backlog feature → expect gate fires
# 6. Both must show the SAME Pro state, because the whole session shares one env var

# Happy path — the Pro user experience:
# 1. AIGON_FORCE_PRO=true aigon server start  (or just unset, with @aigon/pro installed)
# 2. Insights tab works, autonomous start works, nothing is gated
```

## Technical Approach

### The minimum change

```js
// lib/pro.js — after the refactor

'use strict';

let pro = null;
try { pro = require('@aigon/pro'); } catch { /* free tier — @aigon/pro not installed */ }

/**
 * Check if Pro is available.
 *
 * Availability is a global property of the aigon install, not a project-
 * level setting. The only supported override is the AIGON_FORCE_PRO env
 * variable, intended for testing and demos:
 *
 *   AIGON_FORCE_PRO=false → simulate OSS (returns false even with @aigon/pro installed)
 *   AIGON_FORCE_PRO=true  → no-op (Pro still requires the package to be installed)
 *   (unset)               → return !!require('@aigon/pro')
 *
 * Never reads project config. Never throws.
 */
function isProAvailable() {
    const override = process.env.AIGON_FORCE_PRO;
    if (override === 'false' || override === '0') return false;
    return !!pro;
}

module.exports = {
    isProAvailable,
    getPro: () => pro,
    assertProCapability,  // unchanged from feature 221
};
```

That's the entire behavioral change. The rest of the feature is cleanup:
- Delete `forcePro` from committed project configs
- Update e2e setup to set the env var instead of project config
- Update mock-agent env
- Append post-ship note to feature 221
- Update CLAUDE.md reference
- Add the unit test

### Alternatives considered

**Option A: Move to global config (`~/.aigon/config.json`)** — rejected as a primary mechanism because it persists silently across sessions. A user who flipped it once and forgot would see gates (or non-gates) forever. Env vars are naturally scoped to the current session/process tree.

**Option B: Keep `forcePro` in project config but fallback to global** — rejected because it preserves the possibility of per-project Pro state, which is the incoherence this feature is fixing.

**Option C: Drop override entirely, require real `@aigon/pro` installation for testing** — rejected because testing the gate then requires linking/unlinking a package, which is slow, error-prone, and pollutes the repo's node_modules.

**Option D: Env var as primary + global config as optional secondary** — considered. Small added complexity (two places to check). Defer unless someone requests it.

**Default pick: env var only.** Simple, scoped, non-persistent, already aligned with how the test suite passes configuration (see `GIT_SAFE_ENV` in `tests/dashboard-e2e/setup.js` and `tests/integration/mock-agent.js`).

### Cleanup targets (AC5)

Audit required before implementation — confirm these are the only project-config leaks:

- `~/src/aigon/.aigon/config.json` — currently has `"forcePro": true` from ongoing development
- `~/src/brewboard/.aigon/config.json` — currently has `"forcePro": false` from 2026-04-06 manual test
- `tests/dashboard-e2e/setup.js` — no project-config leak today; writes `forcePro: true` somewhere? (audit to confirm)
- Any other fixture `.aigon/config.json` under `tests/`, `scripts/`, or seed repo templates

### What is NOT changing

- `assertProCapability()` — unchanged; still returns boolean, still writes messages to stderr (from the 2026-04-06 `fix(pro)` commit `105dfe27`)
- `lib/pro-bridge.js` — unchanged; route dispatcher is orthogonal to capability gating
- Feature 221's live call site in `lib/commands/feature.js` — unchanged; it calls `assertProCapability` the same way
- `aigon insights` gate in `lib/commands/misc.js` — unchanged; still calls `isProAvailable()`
- The definition of "what counts as Pro" — still `!!require('@aigon/pro')`, still respecting an override, just a different override source
- Pricing, billing, licensing infrastructure — all still out of scope (see `feature-pro-licensing-and-billing.md`)

## Dependencies

- Feature 221 (`pro-gate-infrastructure`) — already shipped; this feature corrects a design decision from 221's spec
- The 2026-04-06 commit `105dfe27` (`fix(pro): surface Pro gate message in dashboard error toast`) — already landed; keeps working after this change

## Out of Scope

- Real license validation, Keygen integration, Stripe — see `feature-pro-licensing-and-billing.md`
- UI treatment for the gate (visible `[Pro]` badges, upgrade CTAs, button greying) — see `feature-159-pro-autonomy-bundle.md`
- Additional Pro capability gates — see `feature-222-pro-gate-ralph-and-autopilot.md`
- Metering, usage tracking, trial allowances — see `feature-pro-autonomy-metering.md`
- Keeping `forcePro` as a project-level setting "for flexibility" — explicitly rejected; this feature deletes that concept
- Automatic migration that moves existing project-level `forcePro` to an env var or global config — too invasive; users are expected to update their habits after reading the CLAUDE.md update

## Open Questions

None. All design decisions made inline (env var, no fallback, no migration, no auto-detection).

## Related

- **Feature 221** (`pro-gate-infrastructure`, shipped) — the feature that codified the project-scope decision this feature corrects. Post-ship note to be added per AC12.
- **Feature 219** (`pro-extension-point-single-seam-for-aigon-pro-integration`, shipped) — `lib/pro-bridge.js` is orthogonal; not affected by this change.
- **Feature 159** (`pro-autonomy-bundle`, backlog) — the visible-Pro-label UX feature; will consume the corrected `isProAvailable()` semantics without modification.
- **Feature 222** (`pro-gate-ralph-and-autopilot`, backlog) — future additional gates; will consume the corrected `isProAvailable()` semantics without modification.
- **CLAUDE.md Rule T1** (pre-push tests) — enforced on implementation.
- **CLAUDE.md Rule T2** (new code ships with a test) — enforced; unit test covering env-var handling is mandatory.
- **The 2026-04-06 incident** — during manual test of feature 221's Pro gate, flipping `forcePro` in brewboard's project config produced inconsistent Pro state between the dashboard top nav (read from `~/src/aigon`) and the autonomous-start subprocess (read from `~/src/brewboard`). The user caught this immediately and demanded the fix.
