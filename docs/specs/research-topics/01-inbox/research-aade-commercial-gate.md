# Research: AADE Commercial Gate Strategy

**Status:** inbox
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
