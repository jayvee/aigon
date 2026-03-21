# Feature: aade-extract-to-private-package

## Summary

Extract all AADE (Amplification) code from the aigon repo into a separate private package (`@aigon/pro` or similar) before any code is pushed to origin. This ensures AADE source code never appears in the public git history. The aigon CLI will optionally require this package at runtime — if present, AADE features are enabled; if absent, free tier only.

## CRITICAL: Must complete before pushing to origin

AADE code is currently in the aigon repo (`lib/insights.js`, dashboard amplification views, git signals in `lib/git.js`). Once pushed to GitHub, it's in public history forever — even if later removed. This feature must be completed **before** the next `git push origin main`.

## Code to Extract

| Current Location | What It Does | Move To |
|---|---|---|
| `lib/insights.js` (~491 lines) | Rule-based insights engine, coaching, trend analysis | `@aigon/pro/insights.js` |
| `templates/dashboard/js/insights.js` | Dashboard insights tab rendering | `@aigon/pro/dashboard/insights.js` |
| `templates/dashboard/js/amplification.js` | Dashboard amplification metrics view | `@aigon/pro/dashboard/amplification.js` |
| `lib/git.js` → `getFeatureGitSignals()` | Rework detection, commit metrics | Keep in aigon (data collection is free, analysis is pro) |
| `lib/utils.js` → `collectAnalyticsData()` | Analytics aggregation | Partially extract (aggregation stays, AADE-specific fields move to pro) |
| `templates/generic/commands/insights.md` | Insights slash command template | `@aigon/pro/commands/insights.md` |

## Acceptance Criteria

- [ ] New private repo created: `aigon-pro` (or `@aigon/pro` npm scope)
- [ ] All AADE-specific code moved to the private package
- [ ] `aigon` CLI detects `@aigon/pro` at runtime: `try { require('@aigon/pro') } catch { /* free tier */ }`
- [ ] `aigon insights` shows "AADE Pro required" when package not installed
- [ ] `aigon insights` works normally when `@aigon/pro` is installed
- [ ] Dashboard amplification tab shows "Upgrade to Pro" when package not installed
- [ ] Dashboard amplification tab works normally when package installed
- [ ] Git signals data collection (`getFeatureGitSignals`) remains in free tier — only analysis/insights are pro
- [ ] No AADE source code remains in aigon repo after extraction
- [ ] `git log` of aigon repo shows no AADE code (use `git filter-repo` to clean history if needed)
- [ ] `npm test` passes in aigon after extraction
- [ ] Private package has its own tests

## Validation

```bash
node -c aigon-cli.js
node -c lib/insights.js  # should fail — file should not exist
npm test
aigon insights  # should show "Pro required" message
```

## Technical Approach

### 1. Create private package

```
~/src/aigon-pro/
├── package.json        # name: "@aigon/pro"
├── index.js            # main entry: exports insights, dashboard components
├── insights.js         # moved from aigon/lib/insights.js
├── dashboard/
│   ├── insights.js     # moved from aigon templates
│   └── amplification.js
├── commands/
│   └── insights.md     # slash command template
└── tests/
```

### 2. Add optional require to aigon

```js
// lib/pro.js — single integration point
let pro = null;
try { pro = require('@aigon/pro'); } catch { /* free tier */ }
module.exports = { isProAvailable: () => !!pro, getPro: () => pro };
```

### 3. Update aigon CLI

- `insights` command: check `isProAvailable()`, show upgrade message or delegate to pro
- Dashboard server: check `isProAvailable()`, serve pro dashboard components or free placeholder
- `collectAnalyticsData()`: keep basic feature counting in free tier, AADE-specific fields only populated when pro available

### 4. Clean git history

After extraction, run `git filter-repo` to remove `lib/insights.js` and AADE dashboard files from history. This ensures the code was never visible even in old commits.

### 5. Linking for development

During development: `npm link @aigon/pro` in the aigon repo so both work together locally without publishing.

## Dependencies

- None — this is the prerequisite for all other AADE commercial features

## Out of Scope

- License key validation (that's aade-licensing-and-billing)
- Free vs pro tier definitions (that's aade-free-tier / aade-pro-tier)
- npm publishing pipeline for @aigon/pro
- Commercial site / pricing page

## Open Questions

- Should `getFeatureGitSignals()` remain in free tier? (Recommendation: yes — data collection is free, analysis is pro. This gives free users rework flags in their logs, which is a teaser for the insights engine.)
- What npm scope to use? `@aigon/pro`, `@aigon/aade`, `aigon-pro`?
- Should the private package be a separate repo or a private directory in a monorepo?

## Related

- Research: #15 aade-commercial-gate
- Feature: aade-free-tier (depends on this)
- Feature: aade-pro-tier (depends on this)
- Feature: aade-licensing-and-billing (depends on this)
