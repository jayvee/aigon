# Feature: kill-utils-js-god-object

## Summary
utils.js (1,788 lines) is a god object that re-exports from 8 modules and owns hooks, feedback constants, analytics (~720 lines), version management, and CLI parsing. Break it apart: inline re-exports at call sites so consumers import directly, move hooks to `lib/hooks.js`, move analytics to `lib/analytics.js` (only real consumer is dashboard), move version management to `lib/version.js`. Delete utils.js entirely and update all import sites.

## User Stories
- [ ] As a maintainer, I want each module to own its domain so I can find code by topic, not by "utils"
- [ ] As a contributor, I want imports that tell me where logic lives instead of routing through a 1,800-line barrel file
- [ ] As a tester, I want to test analytics in isolation without loading hooks, git, and template code

## Acceptance Criteria
- [ ] `lib/utils.js` is deleted (0 lines)
- [ ] `lib/hooks.js` exists: hook registration and execution (<100 lines)
- [ ] `lib/analytics.js` exists: analytics collection and aggregation (<400 lines)
- [ ] `lib/version.js` exists: version check, update, bump logic (<80 lines)
- [ ] Feedback constants move to `lib/constants.js` or inline at call sites
- [ ] All consumers updated to import from the correct module directly
- [ ] `PATHS` and other shared constants stay in `lib/constants.js`
- [ ] All re-exports eliminated — no module acts as a barrel file
- [ ] `npm test` passes; `node --check aigon-cli.js` passes
- [ ] Extracted modules total under 600 lines combined

## Validation
```bash
test ! -f lib/utils.js              # deleted
wc -l lib/hooks.js                  # expect < 100
wc -l lib/analytics.js              # expect < 400
wc -l lib/version.js                # expect < 80
node --check aigon-cli.js
npm test
```

## Technical Approach
- Map every export from utils.js and every consumer (grep for `require.*utils` and `ctx.utils`)
- Group exports by domain: hooks, analytics, version, constants, feedback
- Create focused modules; move functions verbatim (no logic changes)
- Update all `require('./utils')` and `ctx.utils.X` call sites
- Update `buildCtx()` in shared.js to wire new modules
- Delete utils.js last, after all imports are redirected

## Dependencies
- None — pure internal refactor

## Out of Scope
- Changing analytics data format or collection logic
- Modifying hook behavior
- Refactoring the ctx pattern itself
