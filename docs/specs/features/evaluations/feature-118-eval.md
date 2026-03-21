# Evaluation: Feature 118 - aade-amplification-dashboard

**Mode:** Fleet (Multi-agent comparison)

## Spec
See: `./docs/specs/features/04-in-evaluation/feature-118-aade-amplification-dashboard.md`

## Implementations to Compare

- [x] **cc** (Claude): `/Users/jviner/src/aigon-worktrees/feature-118-cc-aade-amplification-dashboard`
- [x] **cx** (Codex): `/Users/jviner/src/aigon-worktrees/feature-118-cx-aade-amplification-dashboard`

## Evaluation Criteria

| Criteria | cc | cx |
|---|---|---|
| Code Quality | 8/10 | 7/10 |
| Spec Compliance | 9/10 | 5/10 |
| Performance | 7/10 | 8/10 |
| Maintainability | 7/10 | 8/10 |
| **Total** | **31/40** | **28/40** |

| Agent | Lines | Score |
|---|---|---|
| cc | 820 | 31/40 |
| cx | 251 | 28/40 |

## Summary

### Strengths & Weaknesses

#### cc (Claude)
- Strengths:
  - Created a dedicated **Amplification tab** in the dashboard — a standalone view with its own nav tab, container, and full rendering module (`amplification.js`, 384 lines)
  - Covers all spec acceptance criteria: cost cards, sparklines (7d/30d), autonomy labels with colour coding, first-pass rate, rework badges, graceful missing-data handling ("—")
  - Added autonomy distribution bar chart (new visual beyond spec — horizontal bars with percentage)
  - Integrated insights section with refresh capability and AI coaching display
  - Repo and period filter controls (7d/30d/90d/all)
  - Refactored `init.js` to use a `hideAllViews()` helper, reducing repeated display:none lines
  - 15 unit tests covering AADE data collection, frontmatter parsing, and analytics integration
  - YAML scalar handling: quote-stripping for autonomy_label, truthy parsing for rework booleans
- Weaknesses:
  - 820 lines is substantial — the amplification.js module duplicates some logic already in logs.js (sparkline building, feature card rendering)
  - Kept the existing embedded Amplification section in logs.js untouched, creating two places that render similar content
  - `buildDailyTrend` is defined both in utils.js (server) and amplification.js (client) — DRY violation
  - No Playwright/integration tests for the new tab UI

#### cx (Codex)
- Strengths:
  - Minimal, focused change (251 lines across 3 files) — backend-only fix for the data contract gap
  - Properly identified that the UI already existed in logs.js and only fixed the missing backend data
  - Used `parseYamlScalar()` for AADE field parsing — more robust than cc's manual quote-stripping
  - Eliminated redundant `parseLogFrontmatterFull()` calls by caching the result once per feature
  - Added Playwright tests (2 tests: renders with data + graceful missing-data handling)
  - `toNullableNumber` and `toNullableBoolean` helpers are clean and reusable
  - Nullable booleans for rework flags (null vs false) — more semantically correct
- Weaknesses:
  - Does NOT create a standalone "Amplification" section/tab — relies on the existing embedded section in the Statistics/Logs view
  - Spec says "New 'Amplification' section visible in the dashboard (collapsible, below existing sections)" — cx leaves it buried inside Statistics, not as a first-class section
  - No sparkline trends, no autonomy distribution chart, no cost cards, no first-pass rate display — the frontend presentation layer is entirely delegated to pre-existing code in logs.js
  - Missing several acceptance criteria: standalone visibility, rolling sparklines as a prominent feature, per-feature rework indicators as visual markers
  - Playwright tests target `.amplification-section` class in the Statistics view, not a standalone section

## Recommendation

**Winner:** cc (Claude)

**Rationale:** The spec explicitly calls for a "New 'Amplification' section visible in the dashboard" with cost cards, sparklines, autonomy labels, and rework indicators. cc delivers all of these as a dedicated tab with full UI. cx correctly identified the backend data gap and fixed it cleanly, but did not build the presentation layer the spec requires — it relies on a pre-existing embedded section that doesn't satisfy the acceptance criteria for a standalone, collapsible section with the specified visual elements.

**Cross-pollination:** Before merging cc, consider adopting from cx: (1) the `parseYamlScalar()` approach for AADE field parsing instead of cc's manual quote-stripping, and (2) the cached `logFrontmatter` pattern that avoids reading the log file multiple times per feature — both are in cx's `lib/utils.js` changes and are cleaner than cc's equivalents.
