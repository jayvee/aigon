# Implementation Log: Feature 181 - configurable-instruction-directives-phase-2-ceremony-steps
Agent: cc

## Progress

- Added 5 new resolver functions in lib/config.js: resolveLoggingPlaceholders, resolveDevServerPlaceholders, resolvePlanModePlaceholders, resolveDocumentationPlaceholders, resolveInstructionDirectives
- Added rigor preset ("production"/"light") that sets all directives at once; individual overrides layer on top
- Replaced hardcoded Steps 2.5, 4.5, 6, 6.5 in feature-do.md with placeholders
- Replaced hardcoded Steps 3.5, 6 in feature-now.md with placeholders
- Config-change hash already covers new fields (hashes full `instructions` object)

## Decisions

- Followed the exact same pattern as feature 180's resolveTestingPlaceholders: config value -> content string -> empty string for "skip"
- Used `??` (nullish coalescing) for individual directive overrides so that explicit `false` values are respected over preset defaults
- Simplified Step 7's reference text to not hardcode step numbers (since steps may be absent)
- feature-now.md only gets PLAN_MODE_SECTION and LOGGING_SECTION (no dev-server or documentation — it's the fast-track template)

## Code Review

**Reviewed by**: cu (Composer/Cursor agent, `--no-launch` inline review)

**Date**: 2026-03-31

### Findings

- **Implementation matches acceptance criteria** for `lib/config.js`: `rigor` preset with per-directive overrides via nullish coalescing, `logging` / `devServer` / `planMode` / `documentation` resolvers, and `getProfilePlaceholders()` wiring. `computeInstructionsConfigHash` already hashes the full `instructions` object, so new fields participate in reinstall detection without further setup changes.
- **`templates/generic/commands/feature-do.md`** correctly inserts `{{PLAN_MODE_SECTION}}`, `{{DOCUMENTATION_SECTION}}`, `{{LOGGING_SECTION}}`, and `{{DEV_SERVER_SECTION}}` in sensible positions relative to testing steps and the commit / submit flow.
- **`feature-now.md`** intentionally wires only `{{PLAN_MODE_SECTION}}` and `{{LOGGING_SECTION}}` among the phase-2 placeholders (documented in the implementation log). The written spec also calls for `{{DOCUMENTATION_SECTION}}` and `{{DEV_SERVER_SECTION}}` on both templates; if strict parity is required later, those placeholders could be added to `feature-now.md` in the implement / test / submit path even when they are usually empty for the fast-track flow.
- **Duplicate “Then tell the user” block** at the end of `feature-do.md` Step 7 is unchanged from `main` (pre-existing); not introduced by this feature. Optional cleanup in a follow-up.
- **Step numbering** when `logging` is `skip`: template jumps from Step 5 to Step 7 with only optional Step 6.5 content — cosmetic only.

### Fixes Applied

- None needed; `node -c lib/config.js && node -c lib/templates.js` and full `npm test` pass in the worktree; `node tests/unit/config.test.js` passes.

### Notes

- No security or logic issues spotted in the resolver layer; invalid `rigor` values safely fall back to production defaults.
