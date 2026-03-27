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

Three agents (cc, gg, cx) researched this topic independently. Key consensus:

1. **Autonomous mode is a strong, defensible Pro gate.** The free tier (Drive mode, interactive commands) remains genuinely useful — not crippleware.
2. **`feature-autopilot`, `research-autopilot`, and `feature-do --autonomous` are the primary gate targets.** These represent unattended orchestration with genuinely higher cost/complexity.
3. **Manual Fleet mode should stay free.** The gate line is "human-in-the-loop vs unattended," not "single vs multiple agents." Users manually launching Fleet agents are still actively directing work.
4. **Use the existing `isProAvailable()` / `getPro()` pattern** in `lib/pro.js`, extended with named capabilities.
5. **Clear upgrade messaging with free fallback** is essential — never nag, always suggest the free alternative.
6. **Bundle autonomous mode with AADE Insights + telemetry** for a coherent Pro story: "do more" + "learn more."
7. **Start with a hard gate, add trial metering later** if conversion is weak. Simplicity over metering sophistication.
8. **Market precedent supports this model.** Roo Code (closest analog), GitHub Copilot, Cursor, Devin, and Factory all gate their most autonomous features. The $20/mo price point is the Schelling point.

Key divergence: CC recommended hybrid metering from day one; CX recommended hard gate first, metering later; GG recommended a full credit system. Evaluation favored CX's phased approach for simplicity.

## Recommendation

**Gate unattended orchestration behind Pro, with phased metering.**

**Phase 1 — Hard gate (pro-autonomy-gate):**
- `feature-autopilot` → blocked, suggest `feature-start`/`feature-do`
- `research-autopilot` → blocked, suggest `research-start`/`research-do`
- `feature-do --autonomous` → blocked, suggest `feature-do` (interactive)
- Named capability system in `lib/pro.js`: `assertProCapability('autonomy')`
- Dashboard upgrade CTAs for autonomous features

**Phase 2 — Metering (pro-autonomy-metering):**
- Local usage tracking in `.aigon/state/usage.json` with monthly reset
- Small trial allowance (3-5 runs/month) — only if conversion data warrants it
- Remote plan sync for richer entitlements

**Always free:** Drive mode, manual Fleet, dashboard, all interactive commands, manual eval/review.

**Framing:** "You drive, Aigon navigates. With Pro, Aigon drives while you sleep." Pro is amplification, not unlocking.

## Output

### Selected Features

| Feature Name | Description | Priority | Spec |
|--------------|-------------|----------|------|
| pro-autonomy-gate | Gate autonomous commands + named capabilities + upgrade messaging + dashboard CTAs | high | `docs/specs/features/01-inbox/feature-pro-autonomy-gate.md` |
| pro-autonomy-metering | Local usage tracking + monthly reset + remote plan sync | medium | `docs/specs/features/01-inbox/feature-pro-autonomy-metering.md` |
| pro-autonomy-bundle | Define Pro package: autonomous + Insights + telemetry; amplification framing and copy | medium | `docs/specs/features/01-inbox/feature-pro-autonomy-bundle.md` |

### Feature Dependencies
- pro-autonomy-metering depends on pro-autonomy-gate
- pro-autonomy-bundle depends on pro-autonomy-gate

### Not Selected (deferred or merged)
- pro-gate-fleet-spawn: Fleet mode stays free — gate is on unattended orchestration, not parallel agents
- pro-gate-batch-runs: Batch runs don't exist yet; gate when built
- pro-credit-system: Premature; start with hard gate, add metering in phase 2 only if needed
