# Research Findings: AADE Commercial Gate Strategy

**Agent:** Claude (cc)
**Research ID:** 15
**Date:** 2026-03-20

---

## Key Findings

### 1. What to Gate — The Boundary Question

**Recommendation: "Data collection free, insights paid" — proven pattern**

The most successful developer tools follow a clear rule: **the value you generate is free; the value you interpret is paid.** This maps perfectly to AADE:

| Layer | Tier | Rationale |
|-------|------|-----------|
| Core Aigon (features, board, agents, worktrees) | Free forever | This IS the product adoption engine. Gating it kills the funnel. |
| Token/cost capture (telemetry adapters) | Free | Data collection costs nothing to serve — it's all local. Collecting data creates investment; users will want the analysis. |
| Git signal computation (rework detection) | Free (basic) / Pro (deep) | Basic stats (commits, lines changed) stay free. Rework pattern detection (thrashing, fix cascades, scope creep) is the Pro analysis layer. |
| Amplification dashboard — basic cards | Free | Show token totals, cost this month, feature count. The "teaser" that creates upgrade desire. |
| Amplification dashboard — trends & history | Pro | Sparklines, rolling averages, cross-feature comparisons, full history. Ongoing value lives here. |
| AI coaching insights (rule-based) | Pro | The 5-10 trend/outlier checks from `aigon insights`. Low LLM cost but high perceived value. |
| AI coaching insights (LLM-powered) | Pro | Per-call API cost justifies gating. "Your rework rate spiked 40% — here's why and what to try." |

**Evidence from analogues:**
- **Mixpanel**: Free data collection (100K users), paid analysis/funnels — [mixpanel.com/pricing](https://mixpanel.com/pricing)
- **PostHog**: 1M free events, paid for volume + advanced features. ~90% of users stay free — [posthog.com/pricing](https://posthog.com/pricing)
- **Raycast**: Free launcher + 1000+ extensions, paid AI + cloud sync at $8/mo — [raycast.com/pricing](https://www.raycast.com/pricing)
- **Warp**: Free terminal, paid AI agent features at $20/mo — [warp.dev/pricing](https://www.warp.dev/pricing)

**The teaser mechanic:** Show "You spent $47.30 on AI tokens this month across 8 features" for free. Gate "Your cost per feature dropped 30% after switching to Fleet mode — here's the breakdown" behind Pro. The free metric creates the curiosity; the paid insight delivers the understanding.

---

### 2. When to Introduce the Gate

**Recommendation: Ship AADE free for 3-6 months, then layer Pro on top**

**The a16z three-pillar framework ([source](https://a16z.com/open-source-from-community-to-commercialization/)):**
1. **Project-community fit** — Developers engage with the OSS tool (stars, usage, contributions)
2. **Product-market fit** — The tool solves a real problem (organic adoption, retention)
3. **Value-market fit** — Users will pay (willingness to pay, not just willingness to use)

Commercialise when all three are validated — not just the first two.

**Case studies — successful transitions:**

| Tool | Free period | Outcome | Key lesson |
|------|-------------|---------|------------|
| **Slack** | 1 year free beta (2013-14) | 30% conversion rate, $27.7B acquisition | 10K message limit = natural friction. 70% of paid users started free. |
| **Zoom** | 7 years generous free (2013-20) | 55% of $100K+ customers started free. 140% net revenue retention. | 40-min cap on groups = usage-based limit, not feature-based. Users experience 100% of the product. |
| **Figma** | 3 years free for individuals (2016-19) | 77% market share, $20B acquisition attempt | Individual adoption → team demand. Free tier targeted future decision-makers. |
| **Discord Nitro** | Core free forever | $575M revenue, 75% from Nitro | Never gate core value. Monetise enhancements and cosmetics. |
| **Obsidian** | App free forever (2020+) | Sustainable indie business | App + plugins free. Sync $4/mo, publish $8/mo. Commercial use now free too (Feb 2025). |

**Case studies — failures:**

| Tool | What went wrong | Lesson |
|------|----------------|--------|
| **Heroku** (2022) | Removed entire free tier. Devs felt betrayed. Mass exodus to Railway/Fly/Render. | Never remove what was free. Add paid on top. |
| **Docker Desktop** (2021) | $5/mo license for companies >250 employees. Felt like taxing invisible infrastructure. | Product must deliver perceived value before charging. |

| Factor | Successful | Failed |
|--------|-----------|--------|
| Free tier after transition | Maintained, still useful | Eliminated or severely limited |
| Upgrade trigger | Natural usage growth | Arbitrary policy change |
| Value perception | Clear additional value | Felt like a tax |
| Communication | Gradual, transparent | Sudden announcement |

**The critical rule:** Never remove something that was free. Only ADD paid features on top.

**Minimum Viable Commercial Product (MVCP) for AADE:**
1. Full Amplification dashboard with trends and history
2. Rework pattern detection with actionable labels
3. `aigon insights` with rule-based coaching (no LLM needed for v1)

This delivers ongoing value without requiring expensive AI inference infrastructure.

---

### 3. Pricing & Packaging

**Recommendation: $9/month or $79/year — single "Pro" tier**

**Solo developer tool pricing landscape (current, verified March 2026):**

| Tool | Monthly | Annual | Model |
|------|---------|--------|-------|
| Obsidian Sync | $4/mo | $48/yr | Service subscription |
| Bear Pro | $2.99/mo | $29.99/yr | App subscription |
| Raycast Pro | $10/mo | $96/yr | Feature + AI subscription |
| Warp Build | $20/mo | — | AI credits |
| Linear (Essentials) | $10/seat/mo | — | Per-seat SaaS |
| 1Password | $2.99/mo | $35.88/yr | Service subscription |
| Amazon Q Developer Pro | $19/user/mo | — | AI + features |
| ngrok Personal | $8/mo | $5/mo (annual) | Usage limits |
| Tailscale Personal Plus | $5/mo | — | User/device limits |

**Developer analytics tools (team-priced, for comparison):**

| Tool | Per-Seat Equivalent | Notes |
|------|---------------------|-------|
| LinearB | ~$35/contributor/mo (Pro) | Free tier for 4 contributors |
| Swarmia | €20-39/dev/mo | Free ≤9 devs |
| Pluralsight Flow | ~$42-58/user/mo | Volume discounts significant |
| Jellyfish | ~$30/user/mo + $10K/yr platform | Enterprise sales-led |
| DX | Not disclosed (contact sales) | Survey-based |

**Why $9/mo is the sweet spot:**
- Below the "needs manager approval" threshold (~$20/mo)
- Matches perception of "saves me 30 min/month" or "saves me $20/month in wasted tokens"
- Competitive with Raycast Pro ($8-10/mo), above Bear ($3/mo) — appropriate for the value
- Annual at $79/yr gives ~27% discount (standard for solo tools)
- $3-10/mo is the proven range for individual dev tool subscriptions

**Why NOT usage-based:**
- Adds billing complexity (metering, invoices, overages)
- Creates anxiety ("will this cost me $50 this month?")
- Solo developers prefer predictable costs
- Only the LLM coaching layer has variable cost — can be rate-limited (e.g., 20 insights/month)

**Why NOT multiple tiers:**
- Solo developer tool, not enterprise SaaS
- Two tiers (Free + Pro) is the maximum complexity needed now
- A "Team" tier can be added later if team features are built
- Every additional tier increases decision friction

**Founding Member pricing:**
- Launch at $5/mo or $39/yr for first 100-200 users
- Locked in for life (or 2 years) — creates urgency and validates demand
- Gradually increase to standard pricing for new users

---

### 4. Technical Implementation

**Recommendation: Cached online validation with Keygen.sh, 14-day offline grace**

**Architecture:**

```
User signs up at aigon.dev → Stripe checkout → webhook → Keygen.sh creates license
                                                          ↓
User runs: aigon activate <license-key>     → POST keygen.sh/api/validate
                                                          ↓
                                             ~/.aigon/license.json cached locally
                                             {
                                               "key": "AIGON-XXXX-XXXX",
                                               "valid": true,
                                               "tier": "pro",
                                               "expires": "2027-03-20",
                                               "lastChecked": "2026-03-20",
                                               "graceUntil": "2026-04-03"
                                             }
                                                          ↓
CLI startup → read license.json → if valid && not expired → unlock Pro
                                → if lastChecked > 14 days → try revalidation
                                → if online fails && within grace → still unlock
                                → if online fails && past grace → degrade to free
```

**CLI gating implementation (~150 lines, new `lib/license.js`):**

```javascript
const LICENSE_PATH = path.join(os.homedir(), '.aigon', 'license.json');
const GRACE_DAYS = 14;

function checkLicense() {
  const license = readLicenseFile();
  if (!license) return { tier: 'free' };
  if (isExpired(license)) return { tier: 'free', reason: 'expired' };
  if (needsRevalidation(license)) {
    const result = tryOnlineValidation(license.key);
    if (result.valid) updateLicenseFile(result);
    else if (withinGrace(license)) return { tier: 'pro', grace: true };
    else return { tier: 'free', reason: 'grace-expired' };
  }
  return { tier: license.tier };
}

function requirePro(featureName) {
  const { tier } = checkLicense();
  if (tier !== 'pro') {
    console.log(`⚡ ${featureName} requires Aigon Pro — aigon.dev/pro`);
    process.exit(0);
  }
}
```

**Why Keygen.sh over build-your-own:**
- Handles license CRUD, validation API, webhook integration
- Supports offline validation with cryptographic signatures
- Free tier: 25 licenses (enough for validation phase)
- Growth tier: $0.10/license/mo (scales with revenue)
- Integrates with Stripe, Paddle, Lemon Squeezy
- [keygen.sh](https://keygen.sh)

**Why cached online over pure Ed25519 offline (Gemini's suggestion):**
- Offline-only = no revocation until key expires (problematic for refunds)
- Cached online: works offline for 14 days, can revoke when needed
- Ed25519 signing is still used *within* Keygen.sh's validation — just not as the sole mechanism

**Alternative approaches evaluated:**

| Approach | Pros | Cons | Used By |
|----------|------|------|---------|
| Online-only validation | Real-time control, instant revocation | Requires internet on every run, latency | ngrok, Warp |
| Cached online + grace period | Works offline, revocable, best UX | Requires validation server | **Recommended** |
| Ed25519 offline-only | Air-gapped compatible, no server needed | Cannot revoke, complex key management | JetBrains offline |
| Separate binary | Clean separation, paid code hidden | Two codebases, distribution overhead | Terraform Enterprise |
| Runtime feature flags | Single codebase, easy to gate | Trivially bypassable in OSS | GitLab |

**Gating integration points in existing code:**
- `lib/commands/infra.js` — gate Amplification dashboard sections
- `lib/utils.js` → `collectAnalyticsData()` — gate historical trend computation
- New `aigon insights` command — gate entirely
- `lib/dashboard-server.js` → `/api/analytics` — gate deep metrics in API response

**Bypass prevention strategy:**
Since Aigon is open source, any local check can be bypassed by editing code. Accept this. The strategy:
1. **Gate on server-side value** for future features (cloud dashboard, team sync)
2. **Social contract** — professionals who get value will pay
3. **Corporate compliance** — add BSL/FCL clause for commercial use of Pro features
4. Don't make bypass trivial (single flag), but don't invest in DRM (it's futile for OSS)

---

### 5. Go-to-Market

**Target buyer:** Solo developers and freelancers who use AI coding tools daily and want to optimise their effectiveness and spending.

**Acquisition funnel:**
```
Discovery (HN, Reddit, X, dev blogs, Awesome lists)
  → Install free Aigon (npm/Homebrew)
    → Use features, board, agents — love the workflow
      → AADE collects data passively
        → User sees basic metrics: "I spent $127 on tokens this month"
          → Curiosity: "Am I improving? Am I wasting tokens?"
            → Upgrade to Pro for trends, coaching, deep analysis
```

**Conversion benchmarks:**
- Mass-market developer tools: 0.3-1% conversion viable with massive adoption
- Enterprise-focused: 1-3% target
- Exceptional: Slack achieved 30% (outlier, team dynamics)
- For a solo dev tool, target **2-5% conversion** of active users

**Distribution channels:**
1. **npm** — primary, lowest friction for Node.js developers
2. **Homebrew** — macOS developers expect this
3. **GitHub** — stars drive discovery; README is the landing page for many
4. **Hacker News** — Show HN launch post for initial wave
5. **Dev Twitter/X** — share insight screenshots ("My AI amplification improved 40%")
6. **Reddit** — r/programming, r/ExperiencedDevs, r/ClaudeAI, r/devtools

**Landing page: Required before commercialising.**
- Simple single-page at aigon.dev
- Sections: what it does, who it's for, free vs Pro, pricing, install command
- Can start simple: GitHub README + Stripe payment link + docs site
- Must exist — developers won't pay without a professional web presence

**Partnership opportunities (ranked by feasibility):**
1. **MCP server integration** — Aigon as MCP server for AI coding tools. Mutually beneficial, technically straightforward.
2. **Claude Code hooks** — already leveraged. Deeper integration via hook ecosystem.
3. **VS Code / Cursor extension** — AADE metrics in sidebar. Note: VS Code Marketplace does NOT support paid extensions — this would be a free companion that upsells to CLI Pro.
4. **Cross-tool analytics content** — "How much does Claude Code cost vs Cursor vs Copilot?" — Aigon can uniquely answer this.

**Competitive positioning:**

> "Every developer analytics tool is built for engineering managers tracking team metrics. Aigon is built for *you* — the solo developer who wants to know if AI is actually making you faster, or just making you spend more."

| Differentiator | AADE | Team Tools (DX, Swarmia, LinearB) |
|---------------|------|----------------------------------|
| Target user | Individual developer | VP Engineering / CTO |
| Data ownership | Local-first, your machine | Cloud, company-owned |
| Privacy | No data leaves your machine | Requires team-wide data collection |
| AI focus | Built for AI-augmented workflows | Retrofitted for AI metrics |
| Price | $9/mo individual | $20-50/seat/mo enterprise |
| Sales motion | Self-serve, npm install | Enterprise sales, annual contracts |

**Don't compete with team tools. Position as complementary:**
- "Use AADE for your personal insights, use Swarmia for your team"
- Individual adoption → future team expansion (the Figma playbook)

---

### 6. Codebase Readiness Assessment

**What already exists in Aigon for AADE:**

| Component | Status | Location |
|-----------|--------|----------|
| Analytics API endpoint | Working | `lib/dashboard-server.js` → `/api/analytics` |
| Feature throughput, cycle time | Working | `lib/utils.js` → `collectAnalyticsData()` |
| Autonomy ratio from wait events | Working | Log frontmatter event parsing |
| First-pass success rate | Working | Event pattern analysis |
| Agent win rates | Working | Evaluation file parsing |
| Dashboard statistics view | Working | `templates/dashboard/js/statistics.js` |
| Log frontmatter system | Working | `lib/utils.js` → `parseLogFrontmatterFull()` |
| Config infrastructure | Working | `lib/config.js` → `.aigon/config.json` |

**What's designed but not built (from Research-13):**

| Feature | Spec | Key Detail |
|---------|------|------------|
| Token capture | `feature-aade-telemetry-adapters` | SessionEnd hook, parses `~/.claude/projects/<hash>/<session>.jsonl` |
| Git signals | `feature-aade-git-signals` | At feature-close: commits, lines changed, rework detection |
| Amplification dashboard | `feature-aade-amplification-dashboard` | New stats section with cost cards, trend sparklines, autonomy labels |
| Insights command | `feature-aade-insights` | Phase 1: rule-based CLI. Phase 2: LLM coaching. Phase 3: dashboard tab |

**What's completely missing:**
- No license/tier/commercial fields in config
- No license validation module
- No feature-flag infrastructure for Pro features
- No Keygen.sh or payment integration
- No landing page

**Architectural decisions already locked in (Research-13):**
- Storage: All AADE data in log frontmatter as flat scalar fields (~15 new fields, ~200 bytes/feature)
- Telemetry: Agent adapters (Claude adapter parses transcript JSONL)
- Autonomy labels: Based on wait-event count (objective, not subjective)
- Efficiency ratio: Tokens per line changed (most practical for trending)
- No composite score initially: Individual indicators more actionable

---

## Sources

### Pricing & Monetisation
- [GitLab Pricing](https://about.gitlab.com/pricing/) — Open core, $29-99/seat/mo
- [Supabase Pricing](https://supabase.com/pricing) — Free hosted + $25/mo Pro
- [PostHog Pricing](https://posthog.com/pricing) — Usage-based, generous free tier
- [Tailscale Pricing](https://tailscale.com/pricing) — Free 3 users, paid from $5/mo
- [Tailscale: How the Free Plan Stays Free](https://tailscale.com/blog/free-plan)
- [ngrok Pricing](https://ngrok.com/pricing) — Free with friction, $8-39/mo paid
- [Railway Pricing](https://railway.com/pricing) — Usage-based, $5/mo minimum
- [Obsidian Pricing](https://obsidian.md/pricing) — App free, sync $4/mo
- [Raycast Pricing](https://www.raycast.com/pricing) — Free core, Pro $8/mo
- [Warp Pricing](https://www.warp.dev/pricing) — Free terminal, Build $20/mo
- [Linear Pricing](https://linear.app/pricing) — $10/seat/mo Essentials
- [Amazon Q Developer Pricing](https://aws.amazon.com/q/developer/pricing/) — Free + $19/mo Pro
- [1Password Pricing](https://1password.com/pricing/password-manager) — $2.99/mo
- [LinearB Pricing](https://linearb.io/pricing) — ~$35/contributor/mo Pro
- [Swarmia](https://www.swarmia.com/) — Free ≤9 devs, €20-39/dev/mo
- [DX Pricing](https://getdx.com/pricing/) — Contact sales
- [Pluralsight Flow](https://www.pluralsight.com/pricing/flow) — $500-700/user/yr

### CLI Licensing & Technical
- [Keygen.sh — Software Licensing API](https://keygen.sh)
- [Keygen.sh — Offline Licenses](https://keygen.sh/docs/choosing-a-licensing-model/offline-licenses/)
- [LicenseGate on GitHub](https://github.com/DevLeoko/license-gate)
- [How to Make Money from CLI Tools (DEV.to)](https://dev.to/chengyixu/how-to-make-money-from-cli-tools-you-build-5609)
- [Open Core Monetisation Strategies (reo.dev)](https://www.reo.dev/blog/monetize-open-source-software)
- [OCV Open Core Handbook](https://handbook.opencoreventures.com/open-core-business-model/)

### Case Studies & Strategy
- [Slack Freemium Strategy Breakdown](https://www.getmonetizely.com/articles/slacks-freemium-strategy-how-they-convert-free-users-to-paying-customers-2024-breakdown)
- [How Slack Converts 30% of Freemium Users](https://medium.com/@cloudapp/how-slack-converts-30-of-their-freemium-users-into-paid-customers-b36081b18734)
- [SBI Growth: Zoom's Freemium Swerve](https://sbigrowth.com/insights/the-famous-freemium-swerve-that-changed-video-conferencing)
- [Figma's Freemium Model vs Adobe](https://www.getmonetizely.com/articles/how-did-figmas-freemium-model-challenge-adobes-subscription-empire)
- [Discord Nitro Monetization Blueprint](https://www.getmonetizely.com/articles/is-discord-nitro-the-blueprint-for-gaming-community-monetization)
- [Heroku Free Tier Removal FAQ](https://help.heroku.com/RSBRUH58/removal-of-heroku-free-product-plans-faq)
- [Docker License Changes](https://www.knowledgehut.com/blog/devops/docker-license-change)
- [a16z: Open Source to Commercialisation](https://a16z.com/open-source-from-community-to-commercialization/)
- [Commercial Open Source GTM Manifesto](https://hackernoon.com/the-commercial-open-source-go-to-market-manifesto)
- [VS Code Paid Extensions Issue](https://github.com/microsoft/vscode/issues/111800)
- [Freemium Pricing (Stripe)](https://stripe.com/resources/more/freemium-pricing-explained)

### Codebase
- Research-13 findings: `docs/specs/research-topics/04-done/research-13-ai-development-effectiveness.md`
- AADE feature specs: `docs/specs/features/01-inbox/feature-aade-*.md`
- Analytics infrastructure: `lib/dashboard-server.js`, `lib/utils.js`
- Memory: `project_aade_commercial.md`

---

## Recommendation

**Open Core Freemium at $9/mo ($79/yr), introduced 3-6 months after free AADE launch.**

### Sequencing:

| Phase | Timeline | Actions |
|-------|----------|---------|
| **1. Build & ship free** | Now → 3 months | Build all 4 AADE features, ship free. Focus on adoption and feedback. |
| **2. Announce & validate** | Month 3-4 | Launch aigon.dev landing page. Open "Founding Member" at $5/mo ($39/yr). |
| **3. Iterate** | Month 4-6 | Collect paying-user feedback. Add LLM coaching. Iterate on Pro features. |
| **4. Standard pricing** | Month 6+ | Raise to $9/mo ($79/yr) for new users. Founders keep their rate. |

### What stays free forever:
- All core Aigon: features, board, agents, worktrees, Fleet/Drive modes
- Token/cost data collection (telemetry adapters)
- Basic AADE metrics (totals, current month stats)
- Basic dashboard (feature throughput, cycle time)

### What's Pro:
- Full Amplification dashboard (trends, history, cross-feature comparison)
- Rework pattern detection and labelling (thrashing, fix cascades, scope creep)
- `aigon insights` command (rule-based + LLM coaching)
- Historical analytics (beyond current month / 7-day window)

### Technical approach:
- Keygen.sh for license management (~$0.10/license/mo at scale)
- Cached online validation with 14-day offline grace period
- `~/.aigon/license.json` for local state
- New `lib/license.js` module (~150 lines)
- Gate at command/API level, not at data collection level
- Stripe for payment → webhook → Keygen.sh license creation

---

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| license-validation-module | Keygen.sh integration with cached online validation, 14-day offline grace, `aigon activate` command | high | none |
| license-config-tier | Add `tier` field to `.aigon/config.json` and `checkLicense()` / `requirePro()` helpers for feature gating | high | license-validation-module |
| aade-freemium-teaser | Show basic AADE metrics (totals, current month) free; display upgrade prompts when users hit Pro boundaries | high | license-config-tier |
| aade-pro-dashboard | Gate Amplification trend sparklines, rolling averages, cross-feature comparison, and full history behind Pro | medium | aade-freemium-teaser, aade-amplification-dashboard |
| aade-pro-insights | Gate `aigon insights` command (rule-based coaching + LLM analysis) behind Pro tier | medium | license-config-tier, aade-insights |
| landing-page-aigon-dev | Single-page marketing site at aigon.dev with value prop, pricing, install command, and Stripe checkout | medium | none |
| stripe-checkout-integration | Stripe checkout flow → webhook → Keygen.sh license creation for self-serve sign-up | medium | license-validation-module, landing-page-aigon-dev |
| founding-member-pricing | Limited-time $5/mo ($39/yr) tier for first 200 users with locked-in rate | low | stripe-checkout-integration |
