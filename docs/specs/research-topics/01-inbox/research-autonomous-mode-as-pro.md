# Research: autonomous-mode-as-pro

## Context

Aigon Pro needs clear, defensible gating points that justify the paid tier while keeping the open-source core valuable. Autonomous mode — where Aigon runs features or batches of features end-to-end without human intervention (autopilot, Fleet orchestration, auto-eval) — is a strong candidate for Pro gating. This research should evaluate whether autonomous execution is the right feature to gate, how competitors handle similar gating, and what the technical implementation would look like.

## Questions to Answer

### Gating viability
- [ ] Is autonomous mode a reasonable gating point? Does it pass the "free tier is still useful" test?
- [ ] What specifically would be gated? (autopilot command? Fleet spawn? auto-eval? batch feature runs?)
- [ ] Would gating autonomous mode frustrate open-source users or feel fair? Where is the line between "power feature" and "basic functionality"?
- [ ] Could there be a usage-based gate instead? (e.g., 3 autonomous runs/month free, unlimited with Pro)

### Competitive landscape
- [ ] How do similar products gate autonomous/agentic features? (Cursor, Windsurf, Roo Code, Devin, Factory, Sweep)
- [ ] Is there a pattern — do competitors gate by autonomy level, usage volume, team size, or feature set?
- [ ] What gating approaches have been criticized by users? What's considered fair?

### Technical implementation
- [ ] How would the gate check work? (Pro license check before `feature-autopilot`, `research-autopilot`, Fleet spawn?)
- [ ] Where are the enforcement points in the codebase? (`lib/commands/feature.js` autopilot, `lib/worktree.js` Fleet spawn?)
- [ ] How would degradation work? (hard block with message, or graceful fallback to Drive mode?)
- [ ] What about the existing `isProAvailable()` / `getPro()` pattern in `lib/pro.js`?

### Bundling strategy
- [ ] What other features should be bundled with autonomous mode in Pro? (insights, telemetry, advanced eval?)
- [ ] Is autonomous mode alone enough to justify Pro, or does it need to be part of a bundle?

## Scope

### In Scope
- Autonomous mode definition and boundaries
- Competitor gating analysis (AI coding tools specifically)
- Technical gating implementation in Aigon
- User perception and fairness considerations
- Pro tier bundling strategy

### Out of Scope
- Pricing (dollar amounts, billing infrastructure)
- Non-autonomous Pro features in isolation (insights, coaching — covered in other research)
- Enterprise tier features (SSO, audit logs, etc.)

## Findings
<!-- Document discoveries, options evaluated, pros/cons -->

## Recommendation
<!-- Summary of recommended approach based on findings -->

## Output
<!-- Based on your recommendation, create the necessary feature specs by running the `aigon feature-create "<name>"` command. Link the newly created files below. -->
- [ ] Feature:
