# Feature: pro-autonomy-bundle

## Summary

Define the Aigon Pro package as a coherent bundle: autonomous orchestration (`feature-autonomous-start`, `research-autopilot`) + AADE Insights + telemetry/cost reporting + future coaching layers. Document the gating boundaries, amplification framing ("You drive, Aigon navigates. With Pro, Aigon drives while you sleep."), and ensure the free/Pro split is clearly communicated in CLI help, dashboard, and docs. This is the product definition feature — it shapes how Pro is presented, not how it's enforced.

## User Stories

- [ ] As a potential Pro user, I can clearly understand what Pro includes vs what's free
- [ ] As a user running `aigon --help`, Pro features are marked but not hidden
- [ ] As a dashboard user, the Pro bundle is explained in a single, clear section

## Acceptance Criteria

- [ ] Pro bundle definition documented: `feature-autonomous-start` + `research-autopilot` + AADE Insights + telemetry
- [ ] Free tier documented: Drive mode, manual Fleet, dashboard, interactive eval/review
- [ ] CLI help output marks Pro-only commands with a `[Pro]` suffix
- [ ] Dashboard includes a Pro section explaining the bundle with amplification framing
- [ ] No feature is described as "locked" or "restricted" — use "amplification" language
- [ ] Admin/policy controls for autonomous runs included in bundle definition

## Validation

```bash
node --check aigon-cli.js
```

## Technical Approach

- Add `[Pro]` markers to command help text for gated commands (`feature-autonomous-start`, `research-autopilot`)
- Dashboard Pro section: single card/panel explaining the bundle, not scattered CTAs
- Framing guide: write copy guidelines for all Pro-facing text (CLI, dashboard, docs)
- Bundle manifest in `@aigon/pro` package defining included capabilities

## Dependencies

- depends_on: pro-autonomy-gate

## Out of Scope

- Dollar pricing, billing infrastructure, payment processing
- Enterprise tier features (SSO, audit logs, team management)
- Implementation of individual bundle components (each has its own feature)

## Notes

- Docs site has a dedicated Pro page at `/docs/pro` — content should align with bundle definition
- User-facing label is "Pro" (not "Amplification"); amplification is internal/marketing framing only
- `feature-autopilot` has been removed — all autonomous orchestration now goes through `feature-autonomous-start`

## Related

- Research: #23 autonomous-mode-as-pro
