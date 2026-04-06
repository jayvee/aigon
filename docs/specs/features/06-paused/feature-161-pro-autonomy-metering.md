# Feature: pro-autonomy-metering

## Summary

Build the infrastructure for tracking autonomous command usage locally and syncing Pro plan details from a remote server. Local usage tracking in `.aigon/state/usage.json` with monthly reset enables a future trial allowance (e.g., 3 autopilot runs/month free). Remote plan sync allows the Pro license to carry richer entitlements (credit balance, capability flags) beyond the current boolean `isProAvailable()` check.

## User Stories

- [ ] As a user with a trial allowance, I can see how many autonomous runs I have remaining this month
- [ ] As a user, my usage counter resets automatically each month based on first-use date
- [ ] As a Pro user, my plan details (capabilities, limits) sync from remote to local config

## Acceptance Criteria

- [ ] `.aigon/state/usage.json` tracks `{ autopilotRuns: { count, resetDate } }` per capability
- [ ] Monthly reset logic: counter resets when current date exceeds `resetDate`
- [ ] `consumeAutonomousCredit()` or equivalent decrements count and returns boolean
- [ ] `getRemainingCredits(capability)` returns current count for display
- [ ] Remote plan sync mechanism writes Pro entitlements to local config
- [ ] All state files are gitignored

## Validation

```bash
node --check aigon-cli.js
node -c lib/pro.js
```

## Technical Approach

- Usage state stored in `.aigon/state/usage.json` (already gitignored directory)
- Monthly reset: set `resetDate` to first-of-next-month on first use; reset count when date passes
- Trust-based, local-only — no server-side enforcement for MVP
- Remote sync: extend `lib/pro.js` to fetch plan details from `@aigon/pro` package's API
- Expose `getRemainingCredits()` for CLI and dashboard display

## Dependencies

- depends_on: pro-autonomy-gate

## Out of Scope

- Server-side usage enforcement or anti-gaming measures
- Billing infrastructure or payment processing
- Setting the specific trial limits (that's a product decision at launch time)

## Notes

- Deprioritised: ship `pro-autonomy-gate` first and add metering only if conversion data shows it's needed
- "Autonomous run" = one invocation of `feature-autonomous-start` or `research-autopilot`, not per-poll

## Related

- Research: #23 autonomous-mode-as-pro
