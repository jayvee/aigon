# Feature: aade-commercial-site

## Summary
Marketing/pricing site at aigon.dev with value proposition, screenshots, plan comparison, privacy FAQ, and checkout links. Includes a future-scoped section for team tier (shared dashboards, multi-repo rollups, org-level analytics). Merges: landing-page-aigon-dev, aade-team-tier.

## User Stories
- [ ] As a potential user, I want to understand what Aigon does and why I should install it from a professional landing page
- [ ] As a free user, I want to see a clear comparison of Free vs Pro so I can decide if upgrading is worth it
- [ ] As a buyer, I want to purchase Pro directly from the site without friction (Stripe/Lemon Squeezy checkout)
- [ ] As a privacy-conscious developer, I want to see that all data stays local on my machine

## Acceptance Criteria
- [ ] Single-page site at aigon.dev (or subdomain)
- [ ] Sections: hero/value prop, what it does, who it's for, Free vs Pro comparison, pricing, install command, privacy FAQ
- [ ] Screenshots of dashboard, insights, and CLI output
- [ ] Checkout button links to Stripe/Lemon Squeezy payment flow
- [ ] Responsive, works on mobile
- [ ] Team tier section: "Coming soon" with feature preview (shared dashboards, multi-repo, org analytics)

## Validation
```bash
# Site-specific validation TBD — likely a separate repo
```

## Technical Approach
- Simple static site or lightweight Next.js app
- Can start minimal: GitHub README + Stripe payment link + docs site
- Must exist before commercialising — developers won't pay without a professional web presence
- Competitive positioning: "Personal engineering intelligence for solo developers" — not a discount team tool

## Dependencies
- aade-licensing-and-billing (checkout integration needs billing backend)
- aigon.dev domain registration

## Out of Scope
- Full team tier implementation (just the marketing section)
- Blog / content marketing
- Detailed documentation site (README + existing docs suffice initially)

## Open Questions
- Separate repo or monorepo with Aigon?
- Static site vs Next.js? Static is simpler but Next.js enables dynamic pricing/checkout
- Domain: aigon.dev? aigon.sh? getaigon.com?

## Related
- Research: research-15-aade-commercial-gate
- Competitive references: raycast.com, obsidian.md, warp.dev (pricing page patterns)
