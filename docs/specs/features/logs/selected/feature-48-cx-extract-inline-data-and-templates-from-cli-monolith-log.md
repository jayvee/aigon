---
status: submitted
updated: 2026-03-15T22:41:46.637Z
startedAt: 2026-03-12T23:42:09+11:00
completedAt: 2026-03-12T23:56:47+11:00
autonomyRatio: 1.00
---

# Implementation Log: Feature 48 - extract-inline-data-and-templates-from-cli-monolith
Agent: cx

## Plan
- Extract inline dashboard HTML template to `templates/dashboard/index.html` and load via `readTemplate()`.
- Extract profile preset prose fields (`testInstructions`, `manualTestingGuidance`, `depCheck`) into `templates/profiles/<profile>/`.
- Extract Ralph autopilot iteration prompt to `templates/prompts/ralph-iteration.txt`.
- Extract CLI help text to `templates/help.txt`.
- Externalize scaffold/root content templates to `templates/scaffold.md` and `templates/root-file.md`.
- Validate no behavior change with syntax check, tests, and command parity checks.

## Progress
- Added new template files:
  - `templates/dashboard/index.html`
  - `templates/help.txt`
  - `templates/scaffold.md`
  - `templates/root-file.md`
  - `templates/prompts/ralph-iteration.txt`
  - `templates/profiles/{web,api,ios,android,library,generic}/{test-instructions.md,manual-testing-guidance.md,dep-check.md}`
- Updated `aigon-cli.js`:
  - `buildDashboardHtml()` now reads `templates/dashboard/index.html` and injects `${INITIAL_DATA}`.
  - `PROFILE_PRESETS` now keeps structured config inline and loads prose fields from `templates/profiles/...`.
  - `buildRalphPrompt()` now reads `templates/prompts/ralph-iteration.txt` and applies placeholders.
  - `help` command now reads `templates/help.txt`.
  - `getScaffoldContent()` now reads `templates/scaffold.md`.
  - `getRootFileContent()` now reads `templates/root-file.md` and injects agent placeholders.
- Validation completed:
  - `node -c aigon-cli.js` passes.
  - `npm test` passes (`All 42 tests passed`).
  - `node aigon-cli.js help` output diffed against pre-change baseline: identical.
  - `node aigon-cli.js board` runs successfully.
  - `node aigon-cli.js doctor` runs successfully.

## Decisions
- Kept profile `devServer` and `setupEnvLine` inline as structured data; only prose/string-heavy fields were extracted.
- Used `readTemplate()` for new runtime loads to keep file path resolution consistent with existing template infrastructure.
- Preserved help output byte-for-byte by switching to `process.stdout.write(helpText)` (avoids an extra newline from `console.log`).

## Code Review

**Reviewed by**: cc (Claude Code)
**Date**: 2026-03-12

### Findings
- `buildDashboardHtml()` used plain `.replace('${INITIAL_DATA}', serializedData)` which is vulnerable to `$` back-reference patterns in the replacement string — if dashboard data contains `$&`, `$'`, or `` $` ``, the output would be corrupted. The rest of the codebase (`processTemplate()`) uses `() => value` to prevent this.
- All 25 template files verified correct — content matches original inline strings
- Profile `trimEnd()` correctly strips trailing newlines from template files to match original inline strings
- `processTemplate()` correctly used for Ralph prompt and root-file templates
- Help text uses `process.stdout.write()` to preserve byte-for-byte output — good decision
- 565 lines removed from aigon-cli.js, 18 new profile files + 5 other template files created

### Fixes Applied
- `ab477dc` — Use `() => serializedData` in `buildDashboardHtml()` to prevent `$` back-reference interpretation

### Notes
- Clean, mechanical extraction — exactly what the spec called for
- Ready for Phase 3 (modularize into lib/ modules)
