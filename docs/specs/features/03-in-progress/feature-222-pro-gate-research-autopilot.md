# Feature: pro-gate-research-autopilot

## Summary
Apply the `assertProCapability()` helper from feature 221 to one remaining unattended orchestration command: `research-autopilot`. This is a pure extension — same helper, same pattern, same messaging format as the `feature-autonomous-start` gate. The only reason it's not already done is that 221's spec scoped it to features, not research. Ralph is NOT gated (per the 2026-04-07 product discussion, `--iterate` stays free as an ergonomic CLI affordance).

## Acceptance Criteria

- [ ] **AC1** — `research-autopilot <id> [agents...]` (user-facing entry at `lib/commands/research.js:~L644`) is blocked when `isProAvailable()` is false. Gate fires via `assertProCapability('Research autopilot', 'aigon research-start <id> + aigon research-do <id>')`.
- [ ] **AC2** — `research-autopilot status <id>` and `research-autopilot stop <id>` remain **ungated** — users must always be able to observe and halt running loops regardless of Pro state (matches the subcommand-scoping rule from 221).
- [ ] **AC3** — `research-start`, `research-do`, `research-review`, `research-eval`, `research-close` remain ungated — only the orchestration command is gated.
- [ ] **AC4** — Gate messaging is consistent with `feature-autonomous-start`: same emoji, same format, same honest "coming later" framing from feature 159.
- [ ] **AC5** — Pre-push check passes: `npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh`.
- [ ] **AC6** — Manual smoke: with `AIGON_FORCE_PRO=false aigon server start`, `aigon research-autopilot 1 cc` is gated, `research-start` and `research-do` still work, `research-autopilot status 1` still works.

## Implementation

~5 lines in `lib/commands/research.js` at the user-facing start branch, after the `status` / `stop` subcommand dispatch:

```js
const { assertProCapability } = require('../pro');
if (!assertProCapability('Research autopilot', 'aigon research-start <id> + aigon research-do <id>')) {
    process.exitCode = 1;
    return;
}
```

Plus any test coverage following the pattern established by 221's test suite.

## What is NOT changing

- `lib/pro.js` — unchanged (helper from 221)
- `lib/commands/feature.js` — unchanged
- Ralph / `feature-do --iterate` — **not gated** (free ergonomic affordance, per the 2026-04-07 discussion)
- Dashboard — no dashboard path for `research-autopilot`, so zero UI impact

## Dependencies

- **Hard**: feature 221 (`pro-gate-infrastructure`, shipped) — provides `assertProCapability()`
- **Soft**: `feature-rename-ralph-flag-to-iterate` (inbox) — can ship in either order; independent concerns

## Related

- **2026-04-07 product discussion**: decided `--iterate` (renamed from `--autonomous`) stays free; only unattended multi-agent orchestration is Pro-gated
- **Feature 221** — the prior art this extends
- **Feature 159** — honest gate messaging framework this consumes
- **Original 222 spec** (`pro-gate-ralph-and-autopilot`) — shrunk to this scope; Ralph gate removed per the 2026-04-07 discussion
