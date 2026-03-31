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
