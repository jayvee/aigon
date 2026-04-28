---
complexity: low
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-28T00:10:28.460Z", actor: "cli/feature-prioritise" }
---

# Feature: rename onboarding command to setup

## Summary
Rename the primary CLI command from `aigon onboarding` to `aigon setup`, keeping `onboarding` as a silent backwards-compatible alias. "Onboarding" is SaaS web-UI language; CLI tools universally say `setup`, `configure`, or `init`. The rename is purely cosmetic — the alias system in `lib/templates.js` means all existing scripts that invoke `aigon onboarding` continue to work without changes.

## User Stories
- [ ] As a new user running `aigon --help` for the first time, I see `setup` in the command list and immediately understand what it does — no mental translation from "onboarding" required.
- [ ] As an existing user who has `aigon onboarding` in a shell script or docs, my scripts continue to work unchanged after upgrading.

## Acceptance Criteria
- [ ] `aigon setup` and `aigon setup --yes` run the full wizard
- [ ] `aigon setup --resume` resumes from the first incomplete step
- [ ] `aigon onboarding` still works (dispatches to the same handler via alias)
- [ ] First-run auto-invocation (new user, no `onboarded: true` in config) still triggers correctly
- [ ] `npm test` passes

## Validation
```bash
node -e "const {createSetupCommands} = require('./lib/commands/setup'); const cmds = createSetupCommands(); console.assert('setup' in cmds, 'setup key missing'); console.assert(!('onboarding' in cmds), 'onboarding key should be alias, not own key'); console.log('OK')"
node aigon-cli.js setup --help
```

## Pre-authorised
- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Technical Approach
Four files, ~5 line changes total. No logic changes — purely renaming the primary key and updating the alias entry.

1. **`lib/templates.js:350`** — Flip primary and alias:
   - Before: `'onboarding': { aliases: ['setup'], argHints: '[--yes] [--resume]' }`
   - After:  `'setup': { aliases: ['onboarding'], argHints: '[--yes] [--resume]' }`

2. **`lib/commands/setup.js` handler key (~line 961)** — Rename command key:
   - Before: `'onboarding': async (args = []) => { ... }`
   - After:  `'setup': async (args = []) => { ... }`

3. **`lib/commands/setup.js` export list (~line 3463)** — Update names array:
   - Before: `[..., 'onboarding', ...]`
   - After:  `[..., 'setup', ...]`

4. **`aigon-cli.js:145`** — First-run auto-invocation:
   - Before: `await commands['onboarding']([])`
   - After:  `await commands['setup']([])`

5. **`lib/onboarding/wizard.js:29`** — User-facing error message:
   - Before: `'aigon onboarding: non-interactive environment detected...'`
   - After:  `'aigon setup: non-interactive environment detected...'`

Note: `SKIP_FIRST_RUN` at `aigon-cli.js:93` already includes both `'onboarding'` and `'setup'` — no change needed there.

## Dependencies
- none

## Out of Scope
- Renaming `global-setup` — that is a separate, narrower command and its name is already accurate
- Updating external documentation (docs site) — separate PR/feature
- Any changes to wizard logic or step flow

## Open Questions
- none

## Related
- Research: none
- Set: onboarding-improvements
