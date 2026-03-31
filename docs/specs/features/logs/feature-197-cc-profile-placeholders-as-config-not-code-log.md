# Implementation Log: Feature 197 - profile-placeholders-as-config-not-code
Agent: cc

## Plan
Extract ~450 lines of profile/instruction directive code from lib/config.js into data files and a dedicated module.

## Progress
- Created `templates/profiles.json` with all 6 profile structural data (devServer, setupEnvLine)
- Created `templates/sections/*.md` for ceremony section templates (autonomous, testing-steps, troubleshooting, etc.)
- Created `lib/profile-placeholders.js` with all extracted functions: profile detection, resolution, instruction directives, placeholder assembly
- Updated `lib/config.js` to import and re-export from new module for backwards compatibility
- All 17 placeholder keys preserved with identical values

## Decisions
- Kept profile markdown string files (`templates/profiles/{name}/*.md`) in place — they were already data, not code
- Created `templates/sections/` for ceremony section templates rather than putting them in profiles.json, since they aren't profile-specific
- Used lazy require for config.js dependency in profile-placeholders.js to avoid circular deps
- Re-exported everything from config.js for full backwards compatibility (no consumer changes needed)

## Results
- `lib/config.js`: 1,438 → 947 lines
- `getProfilePlaceholders()`: 75 → 27 lines
- All 13 tests pass, all syntax checks pass
