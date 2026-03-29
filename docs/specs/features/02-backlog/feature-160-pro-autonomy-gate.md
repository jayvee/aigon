# Feature: pro-autonomy-gate

## Summary

Gate unattended orchestration commands (`feature-autopilot`, `research-autopilot`, `feature-do --autonomous`) behind the Aigon Pro license. Extend `lib/pro.js` with a named capabilities system (e.g., `assertProCapability('autonomy')`) so future Pro features can be gated cleanly. When a gated command is invoked without Pro, display a clear, non-nagging message stating what's blocked, why it's Pro, and the exact free fallback command. Add corresponding upgrade CTAs in the dashboard when autonomous actions are unavailable.

## User Stories

- [ ] As a free user, I can run all interactive/Drive mode commands without restriction
- [ ] As a free user invoking `feature-autopilot`, I see a clear message explaining the Pro gate and suggesting `feature-do` as the free alternative
- [ ] As a Pro user, `feature-autopilot` and `research-autopilot` run without interruption
- [ ] As a free user viewing the dashboard, I see a non-intrusive indicator that autopilot is a Pro feature

## Acceptance Criteria

- [ ] `feature-autopilot` is blocked without Pro; shows fallback to `feature-start`/`feature-do`
- [ ] `research-autopilot` is blocked without Pro; shows fallback to `research-start`/`research-do`
- [ ] `feature-do --autonomous` is blocked without Pro; shows fallback to `feature-do` (interactive)
- [ ] `lib/pro.js` exports `assertProCapability(name)` supporting named capabilities
- [ ] All Drive mode, manual Fleet, dashboard, and interactive commands remain ungated
- [ ] Dashboard shows upgrade messaging for autonomous features when Pro is not available
- [ ] Gate check runs at command entry point, not in low-level worktree/validation plumbing

## Validation

```bash
node --check aigon-cli.js
node -c lib/pro.js
```

## Technical Approach

- Add `assertProCapability(capabilityName, fallbackCommand)` to `lib/pro.js` alongside existing `isProAvailable()`
- Insert gate checks at: `lib/commands/feature.js` (autopilot entry ~L2308, autonomous flag in feature-do), `lib/commands/research.js` (research-autopilot entry)
- Add defensive backstop in `lib/validation.js` for the Ralph/autonomous loop
- Dashboard: add conditional upgrade CTA in autopilot-related UI sections
- Degradation: suggest exact free fallback command, never nag repeatedly

## Dependencies

- None (uses existing `lib/pro.js` pattern)

## Out of Scope

- Usage-based metering / trial allowance (see pro-autonomy-metering)
- Bundle definition and pricing (see pro-autonomy-bundle)
- Gating manual Fleet spawn (`feature-start` with multiple agents stays free)
- Gating batch feature runs (don't exist yet)

## Open Questions

- Should the `--autonomous` flag be hidden from `--help` output for free users, or always visible?

## Related

- Research: #23 autonomous-mode-as-pro
