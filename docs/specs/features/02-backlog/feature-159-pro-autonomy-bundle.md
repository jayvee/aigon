# Feature: pro-autonomy-bundle

## Summary

Define the Aigon Pro package as a coherent bundle: autonomous orchestration (`feature-autonomous-start`, `research-autopilot`) + AADE Insights + telemetry/cost reporting + future coaching layers. Document the gating boundaries, amplification framing ("You drive, Aigon navigates. With Pro, Aigon drives while you sleep."), and ensure the free/Pro split is clearly communicated in CLI help, dashboard, and docs. This is the product definition feature — it shapes how Pro is presented, not how it's enforced.

**Also includes honest-messaging cleanup.** Today the gate messages say "Learn more: https://aigon.build/pro" as if there's a purchase flow on the other side. There isn't yet — Pro is not for sale, and new users who click through find marketing copy but no transactional path. Until there IS a purchase flow (see `feature-pro-licensing-and-billing.md`, deferred), the gate messages must be honest: they should explain the gate, show the free alternative, and acknowledge that Pro is coming later rather than implying "pay up or go home."

## User Stories

- [ ] As a potential Pro user, I can clearly understand what Pro includes vs what's free
- [ ] As a user running `aigon --help`, Pro features are marked but not hidden
- [ ] As a dashboard user, the Pro bundle is explained in a single, clear section
- [ ] As a new OSS user who just installed aigon and hit a gate, I see a message that is honest about the current state — Pro is coming later, here's what to do meanwhile — rather than a dangling "upgrade now" CTA that leads nowhere actionable
- [ ] As a new OSS user, I can find out from `aigon --help` or the README exactly which commands are Pro-gated, so I'm not surprised when I hit a gate mid-workflow

## Acceptance Criteria

### Bundle definition

- [ ] Pro bundle definition documented: `feature-autonomous-start` + `research-autopilot` + AADE Insights + telemetry
- [ ] Free tier documented: Drive mode, manual Fleet, dashboard, interactive eval/review
- [ ] CLI help output marks Pro-only commands with a `[Pro]` suffix (`feature-autonomous-start`, `feature-do --autonomous`, `research-autopilot`, `aigon insights`)
- [ ] Dashboard includes a Pro section explaining the bundle with amplification framing
- [ ] No feature is described as "locked" or "restricted" — use "amplification" language
- [ ] Admin/policy controls for autonomous runs included in bundle definition

### Honest gate messaging (pre-purchase-flow state)

- [ ] **Audit every place the current codebase references the `aigon.build/pro` URL or says "upgrade to Pro":**
    - `lib/pro.js:assertProCapability()` — `Learn more: https://aigon.build/pro`
    - `lib/commands/misc.js:500` — `aigon insights` gate: `Upgrade at: https://aigon.build/pro`
    - Dashboard Insights tab upgrade prompt (whatever file renders it)
    - Any other spot discovered during the audit
- [ ] **Rewrite every gate message so it does NOT promise a purchase flow that doesn't exist.** The message must make three things clear: (1) this is a Pro feature, (2) here's the exact free alternative, (3) Pro is not yet available for purchase — coming later. No "upgrade now" CTAs, no "buy Pro" links, no dangling URLs.
- [ ] **If `aigon.build/pro` is referenced at all**, it must point to a page that is honest about the current state — e.g., a landing page that says "Pro is in development, here's what it will include, join the waitlist" — NOT a marketing page that implies you can buy today. If the existing site copy doesn't match this, flag it; site changes are out of scope for this feature but the mismatch needs to be called out.
- [ ] **CLI help output has a single honest line about Pro state** at the bottom of `aigon --help`: something like `Pro features are currently in development. Commands marked [Pro] will be enabled when Pro launches.` One line, not a pitch.
- [ ] **README has a clear "Pro (coming later)" section** listing which commands are Pro-gated, why, and the free alternatives. No CTAs, no "sign up to pre-order" — just honest product scoping so new users aren't surprised by gates.
- [ ] **Re-run a manual smoke test as a new OSS user** (simulate with `AIGON_FORCE_PRO=false` after feature 226 lands, or with `@aigon/pro` unlinked): click every Pro-gated button in the dashboard, run every Pro-gated CLI command, confirm every message is honest and actionable.

### Non-regression

- [ ] The underlying Pro gate (feature 221's `assertProCapability`) still fires correctly — this feature only changes the message wording, not the gate behavior
- [ ] Pro users (with `@aigon/pro` installed) see no change — they never see the gate messages
- [ ] Pre-push check passes: `npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh`

## Validation

```bash
node --check aigon-cli.js
```

## Technical Approach

- Add `[Pro]` markers to command help text for gated commands (`feature-autonomous-start`, `feature-do --autonomous`, `research-autopilot`, `aigon insights`)
- Dashboard Pro section: single card/panel explaining the bundle, not scattered CTAs
- Framing guide: write copy guidelines for all Pro-facing text (CLI, dashboard, docs)
- Bundle manifest in `@aigon/pro` package defining included capabilities

### Honest gate messaging — suggested copy

Current (dishonest, implies purchase flow that doesn't exist):
```
🔒 Autonomous orchestration is a Pro feature.
   Free alternative: aigon feature-start <id> + aigon feature-do <id>
   Learn more: https://aigon.build/pro
```

Proposed (honest about pre-launch state):
```
🔒 Autonomous orchestration is a Pro feature — coming later.
   Free alternative: aigon feature-start <id> + aigon feature-do <id>
```

Or, if keeping a URL reference:
```
🔒 Autonomous orchestration is a Pro feature — coming later.
   Free alternative: aigon feature-start <id> + aigon feature-do <id>
   Preview: https://aigon.build/pro
```

("Preview" not "Learn more" — acknowledges the destination is informational, not transactional.)

The exact wording is a judgment call during implementation, but the rule is: **never imply a purchase is possible when one isn't**. Exact implementation happens in `lib/pro.js:assertProCapability` and `lib/commands/misc.js:~L500` (insights gate). Both call sites share one copy guideline.

### Audit checklist for the implementation session

Before writing any code, grep the entire repo for these strings and list every occurrence:

- `aigon.build/pro`
- `Upgrade`
- `upgrade to Pro`
- `Learn more: http`
- `Buy Pro` / `Get Pro` / `Purchase`
- `requires Aigon Pro`

Every match must be reviewed and updated or explicitly kept (with a comment saying why). Nothing slips through unaudited.

## Dependencies

- **Hard**: feature 221 (`pro-gate-infrastructure`, shipped) — the gates this feature decorates
- **Hard**: feature 226 (`pro-availability-is-global-not-project-scoped`, backlog) — should land BEFORE this feature so the honest-messaging manual smoke test can actually simulate an OSS user via `AIGON_FORCE_PRO=false` without the per-repo incoherence
- **Soft**: feature 222 (`pro-gate-ralph-and-autopilot`, backlog) — extends the gate set. If 222 lands first, this feature's audit just picks up the extra call sites naturally; if 159 ships first, 222's implementation needs to follow the same honest-messaging guideline

## Out of Scope

- Dollar pricing, billing infrastructure, payment processing → `feature-pro-licensing-and-billing.md`
- Actually building a Pro purchase flow → deferred until there's a concrete reason to sell
- Enterprise tier features (SSO, audit logs, team management)
- Implementation of individual bundle components (each has its own feature)
- Rewriting the `aigon.build/pro` site page itself → flagged during implementation if needed, but site changes are a separate concern handled in the `site/` tree
- Changing how the gate mechanism works → feature 221 already shipped the mechanism, this feature only changes the surface copy and help-text visibility

## Notes

- Docs site has a dedicated Pro page at `/pro` (Next.js route at `site/app/pro/page.tsx`) — content should align with bundle definition AND with the "coming later, no purchase today" honest-messaging guideline. If the page currently has a "Buy now" or "Upgrade" CTA, flag during implementation; site copy fix may need to be a sibling commit.
- User-facing label is "Pro" (not "Amplification"); amplification is internal/marketing framing only
- `feature-autopilot` has been removed — all autonomous orchestration now goes through `feature-autonomous-start`
- **2026-04-06 incident context**: during manual testing of the feature-221 Pro gate, the user (jayvee) observed that a new aigon installer would see `Learn more: https://aigon.build/pro` and click through expecting to buy Pro, only to find marketing copy with no transactional path. This is the core UX concern the honest-messaging section of this feature resolves.

## Related

- Research: #23 autonomous-mode-as-pro
