---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-28T00:10:33.557Z", actor: "cli/feature-prioritise" }
---

# Feature: onboarding demo feature run on brewboard

## Summary
Add an optional "demo" step at the end of the `aigon setup` wizard that runs a real Aigon feature on the cloned Brewboard repo so new users see an agent making an actual code change in a tmux session. This is the "it works on your machine" moment that converts skeptical new users — they watch the terminal spin up, the agent work, and code change, all within the first 5 minutes of installing Aigon. The step is skipped silently with `--yes`, when Brewboard wasn't cloned, or when the user declines.

## User Stories
- [ ] As a new user completing setup for the first time, I'm offered "Want to see Aigon run a feature end to end?" and when I say yes, I watch a tmux session open and an AI agent start changing code in Brewboard.
- [ ] As a user running `aigon setup --yes` (CI or scripted install), the demo step is skipped automatically with no interaction.
- [ ] As a user who already ran the demo (or skipped it), `aigon setup --resume` does not re-offer the step.

## Acceptance Criteria
- [ ] New `'demo'` step ID added to `STEP_IDS` in `lib/onboarding/state.js`, positioned after `'server'` and before `'vault'`
- [ ] Demo step block added to `lib/onboarding/wizard.js` in the corresponding position
- [ ] Step skipped automatically when `--yes` flag is set (written as `'skipped'` in state)
- [ ] Step skipped when Brewboard not found at `~/src/brewboard` (note printed, step written as `'skipped'`)
- [ ] Step skipped when no agent CLI is available (note printed, step written as `'skipped'`)
- [ ] When user confirms: wizard detects the first backlog feature in `~/src/brewboard/docs/specs/features/02-backlog/`, runs `aigon feature-start <id> cc` in that directory, and prints `aigon feature-open <id>` instructions
- [ ] On `feature-start` failure: step is written as `'skipped'` with a warning, wizard continues to vault step (non-blocking)
- [ ] `npm test` passes (state model update covered by existing onboarding state tests)

## Validation
```bash
node -e "
const {STEP_IDS} = require('./lib/onboarding/state');
const demoIdx = STEP_IDS.indexOf('demo');
const serverIdx = STEP_IDS.indexOf('server');
const vaultIdx = STEP_IDS.indexOf('vault');
console.assert(demoIdx > -1, 'demo step missing');
console.assert(demoIdx > serverIdx, 'demo must come after server');
console.assert(demoIdx < vaultIdx, 'demo must come before vault');
console.log('step order OK');
"
```

## Pre-authorised
- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Technical Approach

### `lib/onboarding/state.js`
Add `'demo'` to `STEP_IDS` array:
```js
// Before: ['prereqs', 'terminal', 'agents', 'seed-repo', 'server', 'vault']
// After:  ['prereqs', 'terminal', 'agents', 'seed-repo', 'server', 'demo', 'vault']
```

### `lib/onboarding/wizard.js` — new block between server step and vault step

```
if (shouldRunStep('demo', startStep, state)) {
  // Skip conditions
  if (yesFlag) { writeStepState('demo', 'skipped'); }
  else if (seed-repo was skipped OR ~/src/brewboard doesn't exist) {
    clack.log.info('Skipping demo — Brewboard not available');
    writeStepState('demo', 'skipped');
  }
  else if (no agent binary available) {
    clack.log.info('Skipping demo — no agent CLI installed');
    writeStepState('demo', 'skipped');
  }
  else {
    const confirm = clack.confirm({ message: 'Run a demo feature on Brewboard to see Aigon in action? (~2 min)' });
    if (!confirm) { writeStepState('demo', 'skipped'); }
    else {
      // Detect first backlog feature dynamically
      const backlogDir = '~/src/brewboard/docs/specs/features/02-backlog/';
      const firstSpec = fs.readdirSync(backlogDir).filter(f => f.endsWith('.md'))[0];
      const featureId = firstSpec.match(/feature-(\d+)/)[1];  // e.g. '07'

      clack.log.info('Starting demo feature… watch the terminal open.');
      const result = spawnSync(process.execPath, [aigonCli, 'feature-start', featureId, 'cc'],
        { cwd: brewboardPath, stdio: 'inherit', env: subEnv });

      if (result.status === 0) {
        clack.log.success('Demo feature running!');
        clack.note(`Watch it: cd ~/src/brewboard && aigon feature-open ${featureId}`, 'Demo');
        writeStepState('demo', 'done');
      } else {
        clack.log.warn('Demo start failed — continuing setup.');
        writeStepState('demo', 'skipped');
      }
    }
  }
}
```

Key decisions:
- Feature ID detected dynamically from `02-backlog/` — no hardcoded ID, survives seed resets
- `feature-start` runs with `stdio: 'inherit'` so the tmux launch output is visible to the user
- Failure is non-fatal: step is marked skipped and wizard continues to vault
- `--yes` flag always skips (CI / scripted install safety)

## Dependencies
- depends_on: rename-onboarding-command-to-setup (wizard is named `setup` by the time this ships)

## Out of Scope
- Running the feature to completion — the demo just starts the agent, the user watches from there
- Closing or cleaning up the demo feature after onboarding
- Supporting agents other than `cc` (Claude Code) for the demo — simplest possible default

## Open Questions
- What if `~/src/brewboard` has no features in `02-backlog/`? (Edge case: user ran seed-reset before demo.) Guard: if backlog is empty, skip with a note.

## Related
- Research: none
- Set: onboarding-improvements
- Prior features in set: rename-onboarding-command-to-setup
