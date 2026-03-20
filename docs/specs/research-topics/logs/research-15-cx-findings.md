# Research Findings: aade commercial gate

**Agent:** Codex (cx)
**Research ID:** 15
**Date:** 2026-03-20

---

## Key Findings

### 1. The natural free/paid boundary is not the core workflow

- The strongest open-core pattern is: keep the primary product loop free, and charge for analytics, governance, collaboration, or AI-heavy acceleration. GitLab explicitly says most functionality remains in Free and that paid tiers skew toward manager/director/executive needs rather than gating the core developer loop. [GitLab pricing](https://about.gitlab.com/pricing), [GitLab pricing model](https://handbook.gitlab.com/handbook/company/pricing//)
- For Aigon, that implies `feature-*`, `research-*`, board, worktrees, and the base dashboard should stay free. Gating those would weaken adoption and remove the OSS funnel before AADE has enough data to prove value.
- AADE should follow a layered split:
  - Free: data capture, raw metrics, lightweight dashboard cards, and rule-based insights.
  - Paid: AI coaching, trend interpretation, cross-feature benchmarking, history depth, saved reports, and convenience features that cost money or create differentiated value.
- This matches the prior AADE direction already visible in the repo: `feature-aade-insights.md` already frames rule-based insights as free and AI coaching/dashboard gating as the premium candidate. [feature-aade-insights.md](/Users/jviner/src/aigon/docs/specs/features/01-inbox/feature-aade-insights.md)

### 2. Data collection should be free; interpretation is the premium

- Charging for token capture and git-signal collection is the wrong boundary. Those are infrastructure for trust and habit formation. If users cannot see their own raw data, they cannot believe the paid layer.
- A better teaser is:
  - Free: cost per feature, tokens used, commit/rework flags, simple trends, a small rolling history window, and rule-based CLI insights.
  - Paid: "why this happened," prioritized coaching, anomaly explanations, recommendations across time, cohort-style comparisons, and report persistence.
- This mirrors how several tools separate broad access from advanced value:
  - GitHub Copilot has a free entry point, then paid individual tiers, and charges extra for premium requests beyond bundled allowances. [GitHub Copilot plans](https://github.com/features/copilot/plans), [GitHub Copilot billing](https://docs.github.com/en/billing/managing-billing-for-github-copilot/about-billing-for-github-copilot)
  - Warp includes plans with bundled AI credits and paid reloads rather than making the entire product usage-metered. [Warp pricing](https://www.warp.dev/pricing), [Warp plans docs](https://docs.warp.dev/help/plans-subscriptions-and-pricing)
  - LinearB includes monthly credits inside seat pricing and then charges for additional credits. [LinearB pricing](https://linearb.io/pricing), [LinearB credits](https://linearb.io/how-credits-work)

### 3. The minimum viable commercial product is small

- Aigon does not need a full "enterprise analytics suite" before charging. The MVCP is:
  - Free AADE instrumentation and baseline dashboard
  - Free rule-based `aigon insights`
  - Paid AI coaching with a clear before/after value proposition
  - Paid dashboard history and saved insight snapshots
- That package is easier to explain than "pay for metrics." Developers already pay for productivity layers on top of free cores:
  - GitHub Copilot Pro is $10/month for individuals. [GitHub Copilot plans](https://github.com/features/copilot/plans)
  - Raycast launched Pro for individuals at $8/month while keeping the base launcher free. [Raycast Pro launch](https://www.raycast.com/blog/introducing-raycast-pro)
  - ngrok offers a free plan, then a solo-developer Hobbyist tier at $8/month annual or $10 monthly. [ngrok pricing](https://ngrok.com/pricing)
  - Obsidian keeps the app free and monetises sync/publish/supportive commercial licensing. [Obsidian pricing](https://obsidian.md/pricing)

### 4. Ship free AADE first, but do not wait until the whole vision is complete

- AADE should not be fully paywalled before users experience value. The product needs longitudinal data, screenshots, testimonials, and a habit loop before monetisation.
- But "ship everything free, then gate later" creates backlash if users feel something was taken away. The safer sequence is:
  1. Ship instrumentation and a clearly free baseline.
  2. Announce early that AI coaching, deep history, and advanced analysis are planned as Pro features.
  3. Launch paid beta once the baseline is stable and a small group has at least a few weeks of data.
- Recommendation: commercialise after AADE v1 proves three things, not after "full AADE" exists:
  - data capture is trustworthy,
  - free insights are genuinely useful,
  - paid coaching produces recommendations users would not derive alone.
- A practical threshold is not a vanity user-count target; it is evidence quality. Good launch signals would be roughly 10-20 active AADE users with multi-feature history plus 5+ users who explicitly say the coaching changed behavior. This is an inference from the product shape, not something directly stated in sources.

### 5. Pricing should start with one simple solo-developer tier

- Comparable individual-developer pricing clusters around the low-teens per month:
  - GitHub Copilot Pro: $10/month or $100/year. [GitHub Copilot plans](https://github.com/features/copilot/plans)
  - Raycast Pro launched at $8/month billed annually. [Raycast Pro launch](https://www.raycast.com/blog/introducing-raycast-pro)
  - ngrok Hobbyist: $8/month billed annually or $10 monthly. [ngrok pricing](https://ngrok.com/pricing)
  - Tailscale Personal Plus: $5/month for expanded personal use, while business plans jump to $6 and $18 per active user/month. [Tailscale pricing](https://tailscale.com/pricing)
  - Warp Build starts at $18/month. [Warp pricing](https://www.warp.dev/pricing)
- Team engineering-intelligence tools sit far above that:
  - LinearB Essentials is $29/contributor/month; Enterprise is $59/contributor/month. [LinearB pricing](https://linearb.io/pricing)
  - Swarmia's own buyer guide says it costs around $40 per developer per month. [Swarmia buyer's guide](https://www.swarmia.com/blog/buyers-guide-engineering-intelligence-platforms/)
- That gap is the opening: Aigon can position AADE Pro as "personal engineering intelligence for one developer" rather than a discounted team platform.
- Recommended launch pricing:
  - `AADE Pro`: $12/month or $120/year for individuals.
  - Include a monthly allowance of AI coaching runs rather than unlimited opaque usage.
  - Keep raw metrics and rule-based insights free forever.
- I would avoid pure per-analysis pricing at launch. Developers dislike surprise bills; bundled allowances with optional top-ups or BYOK are easier to understand and align with Copilot/Warp/LinearB patterns. [GitHub Copilot billing](https://docs.github.com/en/billing/managing-billing-for-github-copilot/about-billing-for-github-copilot), [Warp plans docs](https://docs.warp.dev/help/plans-subscriptions-and-pricing)

### 6. A second tier should come later, and it should be team-shaped

- Do not launch with multiple paid tiers unless there is truly separate value. Early on, one paid tier reduces decision friction.
- The obvious later tier is not "Pro Plus"; it is team mode:
  - multi-repo rollups,
  - shared dashboards,
  - manager/lead views,
  - Slack/GitHub/Jira integrations,
  - org-level policy and reporting.
- That follows the broader market split:
  - Tailscale separates personal from business tiers. [Tailscale pricing](https://tailscale.com/pricing)
  - Raycast separates Pro for individuals from Team for organizations. [Raycast Pro](https://www.raycast.com/pro)
  - Linear separates basic workflow from Business features like insights and triage intelligence. [Linear pricing](https://linear.app/pricing)

### 7. The cleanest technical implementation is open core plus hosted licensing

- For a local CLI, the practical answer is not "perfect DRM." It is honest friction reduction for paying users plus enough verification to stop casual bypass.
- Recommended structure:
  - Keep OSS core in the main repo.
  - Put premium checks in the same binary behind capability flags.
  - Validate entitlements online on first activation.
  - Cache a signed entitlement locally for offline use.
  - Revalidate periodically with a grace window.
- This matches modern licensing services:
  - Keygen supports signed license files, offline verification, and explicit guidance to hard-code the public key in the application and verify locally. [Keygen offline licensing](https://keygen.sh/docs/api/cryptography/), [Keygen offline model](https://keygen.sh/docs/choosing-a-licensing-model/offline-licenses/)
  - Lemon Squeezy supports product variants, subscription-linked license keys, activation, and webhook-driven lifecycle updates. [Lemon Squeezy license keys](https://docs.lemonsqueezy.com/guides/tutorials/license-keys), [License keys and subscriptions](https://docs.lemonsqueezy.com/help/licensing/license-keys-subscriptions), [Webhooks](https://docs.lemonsqueezy.com/help/webhooks)
- Recommended implementation details:
  - Billing/payment: Lemon Squeezy or Stripe Billing.
  - License state: Keygen-style signed entitlements, or Lemon Squeezy license keys if simplicity wins over flexibility.
  - Offline behavior: 7-30 day grace period after last successful validation.
  - Local storage: cached entitlement file in `.aigon/` or OS keychain-backed config, plus a verified signature.
- Preventing trivial bypass is about layering:
  - signed entitlements,
  - server-tracked activations,
  - periodic refresh,
  - no premium logic controlled by a plain local boolean.
- None of this stops a determined fork, but that is acceptable in OSS. The real goal is making the legitimate path easier than patching around it.

### 8. Go-to-market should target solo AI-heavy developers first

- The first buyer is not enterprise leadership. It is the developer who already uses AI heavily, wants to understand cost/rework/autonomy patterns, and cannot justify a team engineering-intelligence platform.
- Positioning statement:
  - "Aigon AADE helps individual developers measure whether AI is actually making them faster, cheaper, and less chaotic."
- The funnel should be:
  - OSS Aigon adoption
  - free AADE instrumentation
  - useful free insights and dashboard screenshots
  - prompt to unlock AI coaching/history
  - annual conversion for power users and consultants
- A landing page should exist before commercial launch. Not necessarily a polished brand site first, but at minimum:
  - clear value proposition,
  - screenshots,
  - plan comparison,
  - FAQ on privacy/local data,
  - checkout flow.
- Partnerships are secondary. Marketplace presence can help later, but the primary acquisition loop is content and product-led distribution: users sharing dashboards, writeups, and workflow wins. Raycast's affiliate program is a good example of how developer tools extend word-of-mouth after the product already resonates. [Raycast affiliate program](https://www.raycast.com/blog/affiliate-program)

## Sources

- Local repo context:
  - [research-15 topic](/Users/jviner/src/aigon/docs/specs/research-topics/03-in-progress/research-15-aade-commercial-gate.md)
  - [AADE insights spec](/Users/jviner/src/aigon/docs/specs/features/01-inbox/feature-aade-insights.md)
- Pricing and packaging:
  - https://github.com/features/copilot/plans
  - https://docs.github.com/en/billing/managing-billing-for-github-copilot/about-billing-for-github-copilot
  - https://linearb.io/pricing
  - https://linearb.io/how-credits-work
  - https://linear.app/pricing
  - https://ngrok.com/pricing
  - https://obsidian.md/pricing
  - https://tailscale.com/pricing
  - https://www.raycast.com/blog/introducing-raycast-pro
  - https://www.raycast.com/pro
  - https://www.swarmia.com/blog/buyers-guide-engineering-intelligence-platforms/
  - https://www.warp.dev/pricing
  - https://docs.warp.dev/help/plans-subscriptions-and-pricing
- Open-core and monetisation patterns:
  - https://about.gitlab.com/pricing
  - https://handbook.gitlab.com/handbook/company/pricing//
- Licensing and billing implementation:
  - https://keygen.sh/docs/api/cryptography/
  - https://keygen.sh/docs/choosing-a-licensing-model/offline-licenses/
  - https://keygen.sh/docs/relay/
  - https://docs.lemonsqueezy.com/guides/tutorials/license-keys
  - https://docs.lemonsqueezy.com/help/licensing/license-keys-subscriptions
  - https://docs.lemonsqueezy.com/help/webhooks
  - https://docs.stripe.com/billing/subscriptions/overview

## Recommendation

Launch AADE as a free instrumentation layer plus a paid interpretation layer.

Concretely:

1. Keep all core Aigon workflow free: features, research, board, worktrees, and the base dashboard.
2. Make AADE raw capture free: token/cost telemetry, git signals, rework flags, and a lightweight dashboard with short history.
3. Make rule-based `aigon insights` free forever.
4. Launch `AADE Pro` at about `$12/month` or `$120/year` once the free layer is trustworthy and a small cohort has accumulated useful history.
5. Gate the things users cannot easily recreate themselves: AI coaching, longer history, saved reports, cross-feature comparisons, and convenience analysis.
6. Implement licensing with hosted billing plus signed offline entitlements and a grace period, not a purely online lock and not an honor system.
7. Add a later team tier only after individual Pro has traction.

This preserves the OSS adoption loop, avoids paywalling the habit-forming parts of AADE, and prices Aigon where solo developers already pay for productivity tools rather than where enterprise engineering-intelligence vendors price seats.

## Suggested Features

<!--
Use the table format below. Guidelines:
- feature-name: Use kebab-case, be specific (e.g., "user-auth-jwt" not "authentication")
- description: One sentence explaining the capability
- priority: high (must-have), medium (should-have), low (nice-to-have)
- depends-on: Other feature names this depends on, or "none"
-->

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| aade-free-instrumentation | Capture token, cost, git-signal, and rework telemetry locally and expose raw metrics in the free product. | high | none |
| aade-free-rule-insights | Provide rule-based AADE insights in CLI and dashboard without requiring a paid license. | high | aade-free-instrumentation |
| aade-pro-ai-coaching | Add gated AI-generated coaching and interpretation on top of aggregated AADE data. | high | aade-free-rule-insights |
| aade-pro-history-and-reports | Unlock longer history retention, saved insight snapshots, and cross-feature comparison views for paid users. | medium | aade-free-instrumentation |
| aade-license-and-billing | Add subscription billing, entitlement sync, local signed-license cache, and offline grace-period checks. | high | none |
| aigon-pricing-site | Publish a lightweight marketing/pricing site with screenshots, plan comparison, privacy FAQ, and checkout links. | medium | none |
| aade-team-tier | Add shared dashboards, multi-repo rollups, and org-level analytics as a later team-focused paid tier. | low | aade-pro-history-and-reports |
