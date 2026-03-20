# Research Findings: aade commercial gate

**Agent:** Gemini (gg)
**Research ID:** 15
**Date:** 2026-03-20

---

## Key Findings

### 1. What to Gate (Segmentation)
- The core CLI tool (data collection, agents, board) must remain free to build top-of-funnel adoption and maintain open-source community goodwill.
- The **AADE insights layer** (AI-powered analysis, deep rework detection, amplification dashboard) is the natural commercial boundary.
- A "freemium teaser" approach is effective: show high-level metrics (e.g., token usage, basic git signals) for free, but gate the deep AI coaching and historical trend analysis.

### 2. When to Introduce the Gate
- Do not gate until AADE is fully built and has demonstrated undeniable value to free users.
- A common successful pattern for solo developer tools is offering a "Founding Member" lifetime deal (LTD) or heavily discounted early subscription to validate the market and generate initial cash flow, before switching to a standard subscription model.

### 3. Pricing & Packaging
- The industry is moving away from strict per-seat pricing toward **hybrid models** due to variable AI costs.
- For solo developers, a flat subscription ($10-$20/month) is acceptable only if the value is continuous.
- However, because AADE relies on AI inference (LLMs), a **Base Subscription + Usage Credits** model is safer to protect margins against power users.

### 4. Technical Implementation (Offline CLI)
- **Open Core:** Ship a single binary, but keep the AADE analysis logic gated behind a license check.
- **License Validation:** Use **Asymmetric Cryptography (Ed25519)**. The license key contains a JSON payload (user ID, expiry) signed by a private key. The CLI uses an embedded public key to verify the signature locally without needing a constant internet connection.
- **Offline Grace Period:** Allow offline usage for 14-30 days by caching the verified signature, checking in with a central server (like Keygen.sh or Lemon Squeezy) periodically.
- Because it's a local CLI, absolute DRM is impossible. Rely on the "honor system" for individual developers, focusing enforcement on corporate users where legal compliance is a driver.

### 5. Go-to-Market
- **Target:** Power solo developers and freelancers first, who value their time and can justify the cost as a business expense.
- **Funnel:** Free OSS adoption -> Realize they are wasting tokens/time -> Upgrade to AADE to optimize workflow.

## Sources
- [Dev.to: Monetizing Open Core CLI Tools](https://dev.to)
- [OpenCoreVentures: Software Licensing for CLI Tools](https://opencoreventures.com)
- [Keygen.sh: Offline License Validation](https://keygen.sh)
- Industry trends on "Developer Tool Pricing 2025/2026" (Shift to usage-based vs. per-seat).

## Recommendation
Adopt an **Open Core Freemium** model. Keep all Aigon core workflows and basic AADE data collection free. Gate the advanced AADE AI insights behind a $15/month subscription (or equivalent usage-based token model). Implement license validation using Ed25519 signatures to allow local offline verification with a 30-day grace period. Launch with a limited-time "Founding Member" tier to validate demand.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| license-validation-core | Ed25519 public key verification logic for offline CLI license checks | high | none |
| aade-freemium-teaser | Expose basic AADE metrics (e.g., token count) for free, with prompts to upgrade for insights | high | none |
| license-grace-period | Local caching of license state to allow 30-day offline usage | medium | license-validation-core |
| aade-premium-insights | The gated AI analysis layer providing deep rework and efficiency coaching | high | license-validation-core |
