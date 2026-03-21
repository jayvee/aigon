# Feature: aade-licensing-and-billing

## Summary
End-to-end licensing and billing for Aigon Pro: Keygen.sh/Ed25519 license validation with cached online checks, 14-day offline grace period, `aigon activate` command, tier config with `checkLicense()`/`requirePro()` helpers, Stripe/Lemon Squeezy checkout integration, and founding member pricing ($5/mo / $39/yr for first 200 users). Merges: license-validation-module, license-config-tier, stripe-checkout-integration, founding-member-pricing.

## User Stories
- [ ] As a developer, I want to run `aigon activate <key>` to unlock Pro features with my license key
- [ ] As a developer, I want Pro features to work offline for at least 14 days without revalidation
- [ ] As a developer, I want to purchase a Pro license via a simple checkout flow without contacting sales
- [ ] As a founding member, I want my discounted rate ($5/mo) locked in permanently

## Acceptance Criteria
- [ ] New `lib/license.js` module (~150 lines) with `checkLicense()`, `requirePro(featureName)` helpers
- [ ] License state cached at `~/.aigon/license.json` with key, valid, tier, expires, lastChecked, graceUntil fields
- [ ] `aigon activate <key>` validates against Keygen.sh API and caches locally
- [ ] Offline grace period: 14 days after last successful validation before degrading to free
- [ ] `tier` field added to `.aigon/config.json`
- [ ] `requirePro()` shows friendly message with `aigon.dev/pro` link when feature is gated
- [ ] Stripe/Lemon Squeezy checkout → webhook → Keygen.sh license creation (self-serve)
- [ ] Founding member tier: first 200 licenses at $5/mo ($39/yr), rate locked for life
- [ ] Standard pricing: ~$9-12/mo (~$79-99/yr) for subsequent users

## Validation
```bash
node --check aigon-cli.js
node -c lib/license.js
```

## Technical Approach
- **Keygen.sh** for license CRUD, validation API, webhook integration (free tier: 25 licenses, growth: $0.10/license/mo)
- **Cached online validation**: POST to Keygen.sh on activation + periodic revalidation; Ed25519 signatures for offline verification
- **Grace period**: If online check fails within 14 days of last success, still unlock Pro
- **Gating integration points**: `lib/commands/infra.js` (dashboard sections), `lib/utils.js` (historical trends), new `aigon insights` command, `lib/dashboard-server.js` (`/api/analytics` deep metrics)
- **Bypass strategy**: Accept that OSS can be forked; focus on social contract, corporate compliance (BSL/FCL clause), and making the legitimate path easier than patching
- **Payment**: Stripe or Lemon Squeezy → webhook → Keygen.sh license creation

## Dependencies
- aade-free-tier (need features to gate before building the gate)
- Keygen.sh account setup
- Stripe or Lemon Squeezy account setup
- aigon.dev domain

## Out of Scope
- Team/org billing (future aade-team-tier scope)
- Usage-based metering (flat subscription only)
- DRM or anti-piracy measures beyond basic validation

## Open Questions
- Stripe vs Lemon Squeezy? Lemon Squeezy is simpler (handles tax, MoR) but Stripe is more flexible
- Exact price point: $9/mo (cc), $12/mo (cx), or $15/mo (gg)?
- Founding member cap: 100 or 200 users?

## Related
- Research: research-15-aade-commercial-gate
- Keygen.sh docs: https://keygen.sh/docs/choosing-a-licensing-model/offline-licenses/
