# Research: AADE Commercial Gate Strategy

**Status:** submitted
**Created:** 2026-03-17

## Context

Aigon is currently a free, open-source CLI tool. The AADE (Aigon AI Development Effectiveness) feature set — token/cost tracking, git signal analysis, rework detection, amplification dashboard, and AI-powered insights — represents a natural commercial tier that no competitor currently offers for individual developers.

This research investigates when, how, and at what point to introduce a commercial gate around AADE, and the broader question of how to structure Aigon as a commercial product.

## Questions to Answer

### 1. What to Gate

- [ ] Which AADE features belong in free vs commercial? Where is the natural boundary?
- [ ] Should the data collection (token capture, git signals) be free, with only the analysis/insights layer gated?
- [ ] Is there a "teaser" approach — show basic metrics free, gate the AI coaching and deep analysis?
- [ ] What about the core Aigon workflow (features, board, agents)? Does that stay fully free?
- [ ] Are there other potential commercial features beyond AADE (team mode, multi-repo, integrations)?

### 2. When to Introduce the Gate

- [ ] At what maturity level should Aigon introduce paid features? (user count, feature completeness, market validation)
- [ ] Should AADE ship free first to build adoption, then gate later? What's the risk of a free-to-paid transition?
- [ ] Is there a minimum viable commercial product (MVCP) — the smallest set of paid features worth charging for?
- [ ] What's the timeline? Should commercialisation happen before or after AADE is fully built?

### 3. Pricing & Packaging

- [ ] What do comparable tools charge? (DX, Cadence, LinearB, Swarmia — all team-priced, but what's the per-seat equivalent?)
- [ ] What pricing model fits a solo developer tool? (monthly subscription, annual, one-time, usage-based?)
- [ ] Is there a "pro" tier and an "enterprise/team" tier, or just one paid tier?
- [ ] What price point feels fair for an individual developer? ($10/mo? $20/mo? $5/mo?)
- [ ] Should the AI insights layer be usage-based (per-analysis) or flat-rate?

### 4. Technical Implementation

- [ ] How to implement a license/gate in a CLI tool that runs locally?
- [ ] License key validation — online check, offline grace period, or honour system?
- [ ] How do open-source CLI tools typically handle commercial features? (open core, separate binary, feature flags?)
- [ ] What's the hosting/infrastructure needed? (license server, payment processing, account management)
- [ ] How to prevent trivial bypass while keeping the OSS community goodwill?

### 5. Go-to-Market

- [ ] Who is the target buyer? Solo developers, freelancers, small teams, enterprises?
- [ ] What's the acquisition funnel? (OSS adoption → power user → paid conversion)
- [ ] Are there partnership opportunities? (Claude Code marketplace, Cursor extensions, VS Code marketplace)
- [ ] What's the competitive positioning statement?
- [ ] Should Aigon have a landing page / marketing site before commercialising?

## Scope

**In scope:**
- Commercial strategy for AADE specifically
- Pricing research and competitive analysis
- Technical approaches to gating in a CLI/OSS context
- Timeline and sequencing recommendations

**Out of scope:**
- Implementing the gate (this is research only)
- Building AADE features (covered by research-13 suggested features)
- Legal entity setup, tax, incorporation
- Detailed marketing plans

## Inspiration

- **Open core model**: GitLab, Supabase, PostHog — free OSS core + paid features
- **CLI monetisation**: Tailscale, ngrok, Railway — CLI tools with commercial tiers
- **Developer tool pricing**: Linear ($10/seat), Raycast Pro ($8/mo), Warp ($22/seat)
- **Solo developer tools**: Obsidian ($50/yr sync), Bear ($30/yr), Things ($50 one-time)

## Recommendation

**Open Core Freemium at ~$9-12/mo, introduced after free AADE launch proves value.**

### Consensus across all agents (cc, cx, gg):

1. **Core Aigon stays free forever** — features, board, agents, worktrees, dashboard basics
2. **Data collection free, interpretation paid** — raw telemetry free; AI coaching, trends, deep analysis are Pro
3. **Freemium teaser model** — show basic metrics free to create upgrade desire
4. **Ship AADE free first** — never remove what was free; add paid on top
5. **Single Pro tier initially** — add Team tier later when justified
6. **Open core + cached license validation** — Keygen.sh with offline grace period (14-30 days)
7. **Target solo AI-heavy developers** — not managers, not enterprises (yet)
8. **Landing page required** before commercialising
9. **Founding Member pricing** to validate demand

### Key divergences:

| Topic | Claude (cc) | Codex (cx) | Gemini (gg) |
|-------|------------|------------|-------------|
| Price point | $9/mo / $79/yr | $12/mo / $120/yr | $15/mo |
| Rule-based insights | Pro (gated) | Free forever | Not separated |
| AI cost model | Flat-rate (rate-limited) | Bundled allowance + top-ups | Base + usage credits |
| License validation | Cached online (Keygen.sh) | Keygen or Lemon Squeezy | Ed25519 offline-first |
| Payment processor | Stripe | Lemon Squeezy or Stripe | Not specified |

### Sequencing:

| Phase | Actions |
|-------|---------|
| **1. Build & ship free** | Build AADE features, ship free. Focus on adoption and feedback. |
| **2. Announce & validate** | Launch aigon.dev landing page. Open Founding Member pricing. |
| **3. Iterate** | Collect paying-user feedback. Add LLM coaching. Iterate on Pro features. |
| **4. Standard pricing** | Raise to standard pricing for new users. Founders keep their rate. |

## Output

### Selected Features (Consolidated)

12 original features merged into 4 to reduce overhead:

| Feature Name | Description | Priority | Merges | Create Command |
|--------------|-------------|----------|--------|----------------|
| aade-free-tier | Capture token/cost/git-signal/rework telemetry locally, expose raw metrics and rule-based insights in CLI and dashboard — all free forever, with upgrade prompts at Pro boundaries | high | aade-free-instrumentation, aade-free-rule-insights, aade-freemium-teaser | `aigon feature-create "aade-free-tier"` |
| aade-licensing-and-billing | Keygen.sh/Ed25519 license validation, `aigon activate` command, tier config with `checkLicense()`/`requirePro()` helpers, Stripe/Lemon Squeezy checkout integration, founding member pricing | high | license-validation-module, license-config-tier, stripe-checkout-integration, founding-member-pricing | `aigon feature-create "aade-licensing-and-billing"` |
| aade-pro-tier | Gate AI coaching, trend sparklines, rolling averages, cross-feature comparison, full history, and `aigon insights` (rule-based + LLM) behind Pro license | medium | aade-pro-ai-coaching, aade-pro-dashboard, aade-pro-insights | `aigon feature-create "aade-pro-tier"` |
| aade-commercial-site | Marketing/pricing site at aigon.dev with value prop, screenshots, plan comparison, privacy FAQ, checkout links. Team tier (shared dashboards, multi-repo rollups) scoped as future section. | medium | landing-page-aigon-dev, aade-team-tier | `aigon feature-create "aade-commercial-site"` |

### Feature Dependencies
- aade-free-tier → build first (needs data before anything can be gated)
- aade-licensing-and-billing → depends on aade-free-tier (gate mechanism requires features to gate)
- aade-pro-tier → depends on aade-licensing-and-billing (gated features need the gate)
- aade-commercial-site → depends on aade-licensing-and-billing (checkout needs billing integration)
