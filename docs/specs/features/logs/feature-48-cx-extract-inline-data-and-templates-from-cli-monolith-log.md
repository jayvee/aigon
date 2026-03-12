---
status: implementing
updated: 2026-03-12T11:43:23.493Z
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
