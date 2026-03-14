# Feature: playwright-verification

## Summary

Add an automated browser-based verification step to the Feature Do workflow, occurring after implementation and tests pass but before the agent signals completion. The agent creates test data (e.g. YAML), runs Playwright end-to-end tests against the running dev server, records the interaction as video or screenshots, and presents the recording to the user for visual verification. In manual mode, the user can then run their own manual testing in the same browser session. In auto-submit mode, the recordings are saved to the implementation log for the evaluator to review later.

## User Stories

- [ ] As a user reviewing a feature implementation, I want to see a video/screenshot recording of automated browser tests so I can visually verify the UX matches my expectations without manually clicking through everything
- [ ] As a user in Fleet mode with multiple agents, I want each agent's implementation to include visual proof of the feature working, so I can compare implementations side by side
- [ ] As a user, after the automated browser test runs, I want the option to continue the browser session for my own manual testing so I can explore edge cases
- [ ] As a user, I want the browser session to be clean — no onboarding modals, no "save password" prompts, no cookie banners — so testing is fast and focused
- [ ] As a user in autonomous/auto-submit mode, I want the recordings saved alongside the implementation log so the evaluator can review them without re-running the feature

## Acceptance Criteria

- [ ] A new Step 4.2 (between tests and manual testing guidance) is added to `feature-do.md` for Playwright-based browser verification
- [ ] The step is gated behind a project-level config flag (e.g. `.aigon/config.json` → `verification.playwright.enabled: true`) — projects without Playwright are unaffected
- [ ] The agent creates a test data file (YAML or JSON) tailored to the feature's acceptance criteria, placed in a conventional location (e.g. `tests/e2e/fixtures/`)
- [ ] The agent writes or generates a Playwright test script that exercises the feature's key user flows derived from acceptance criteria
- [ ] The dev server is started (via `aigon dev-server start`) before running the Playwright test, and the test targets the correct port/URL
- [ ] Playwright runs with video recording enabled (`video: 'on'`) and/or screenshot-on-failure, outputting to a known artifacts directory (e.g. `tests/e2e/results/`)
- [ ] After the test completes, the agent presents the path to the recording artifacts and a summary of pass/fail results
- [ ] In manual mode: the agent opens a persistent browser session (via `npx playwright open` or similar) for the user to continue manual testing, then waits
- [ ] In auto-submit mode: recordings are referenced in the implementation log and the agent proceeds without waiting
- [ ] The browser context is configured for clean testing: `--no-first-run`, localStorage pre-seeded to dismiss onboarding, password-save prompts suppressed via browser args (`--password-store=basic`, `--disable-save-password-bubble`)
- [ ] A new profile placeholder `{{PLAYWRIGHT_VERIFICATION}}` is added, populated only for `web` and `api` profiles (empty for ios/android/library/generic)

## Validation

```bash
node -c aigon-cli.js
```

## Technical Approach

### New config: `verification.playwright`

Add an optional section to `.aigon/config.json`:

```json
{
  "verification": {
    "playwright": {
      "enabled": true,
      "artifactsDir": "tests/e2e/results",
      "fixturesDir": "tests/e2e/fixtures",
      "baseUrl": null,
      "browserArgs": ["--disable-extensions", "--no-first-run", "--password-store=basic"]
    }
  }
}
```

When `enabled` is false or absent, the step is a no-op and the placeholder renders empty.

### New placeholder: `PLAYWRIGHT_VERIFICATION`

Add to `PROFILE_PRESETS` for `web` and `api` profiles. Inject via `getProfilePlaceholders()`.

**Content for web/api profiles:**

```markdown
### Step 4.2: Automated browser verification

If Playwright verification is enabled in `.aigon/config.json`:

1. Ensure dev server is running (`aigon dev-server start` if not already started)
2. Create test fixture data for this feature in the configured fixtures directory
3. Write a Playwright test script that exercises the feature's acceptance criteria as end-to-end user flows
4. Run the test with video recording:
   ```bash
   npx playwright test <test-file> --reporter=list --video=on --output=<artifacts-dir>
   ```
5. Present results:
   - Pass/fail summary
   - Path to video recording(s) and/or screenshots
   - If any tests failed: include failure details

**If `MANUAL_MODE`:** After automated verification, open a persistent browser for manual testing:
   ```bash
   npx playwright open <dev-server-url>
   ```
   Then **continue to Step 4.5** (manual testing checklist) — the browser stays open.

**If `AUTO_SUBMIT_ACTIVE`:** Note the artifact paths in the implementation log and proceed.
```

**For non-web profiles:** Empty string (no browser verification for iOS/Android/library/generic).

### Template change: `feature-do.md`

Insert `{{PLAYWRIGHT_VERIFICATION}}` in Step 4, between the test instructions and `{{MANUAL_TESTING_GUIDANCE}}`:

```markdown
### Worktree Mode (Drive worktree or Fleet)
{{WORKTREE_TEST_INSTRUCTIONS}}
{{AGENT_DEV_SERVER_NOTE}}
> **Project-specific steps?** Check your root instructions file (e.g. AGENTS.md) for test commands.

{{PLAYWRIGHT_VERIFICATION}}

{{MANUAL_TESTING_GUIDANCE}}
```

### Browser context optimisation

The placeholder text instructs the agent to configure the Playwright browser context with:
- `--no-first-run` and `--disable-default-apps` chromium flags
- Pre-seeded localStorage/cookies to skip onboarding flows (project-specific, read from fixture data)
- `--password-store=basic` to suppress "save password" prompts
- `--disable-save-password-bubble` for additional suppression
- `acceptDownloads: true`, `ignoreHTTPSErrors: true` for smoother test runs

### Autonomous mode integration

The autonomous validation loop in `lib/utils.js` (`runRalphCommand`) already runs profile-level and feature-specific validation. Playwright tests should be added as a feature-specific validation command in the spec's `## Validation` section when the feature is web-facing:

```bash
npx playwright test tests/e2e/ --reporter=list
```

This means autonomous mode gets both the standard validation AND the visual recording from Step 4.2.

### Artifacts and recording

- Videos saved to `<artifactsDir>/video/` (Playwright default structure)
- Screenshots on failure saved to `<artifactsDir>/screenshots/`
- The agent should reference these paths in the implementation log (`feature-<ID>-<agent>-log.md`) so the evaluator can review them
- In Fleet mode, each agent's worktree produces its own artifacts — no conflicts

## Dependencies

- Playwright installed in the target project (`npx playwright install` for browsers)
- Profile placeholder system (existing: `MANUAL_TESTING_GUIDANCE`, `WORKTREE_TEST_INSTRUCTIONS`)
- Dev server command (`aigon dev-server start` / `aigon dev-server url`)
- `feature-do.md` template (source of truth in `templates/generic/commands/`)
- After changes: run `aigon install-agent cc` to sync working copies

## Out of Scope

- Installing Playwright into target projects automatically — the user must set this up
- Visual regression testing (pixel-diff comparisons) — this is about recording for human review, not automated visual assertions
- Mobile browser testing (Playwright mobile emulation could be a follow-up)
- Modifying `feature-submit.md` or `feature-eval.md` — those consume the artifacts but don't need changes now
- Non-web profiles (iOS, Android, library, generic) — they have their own testing paradigms

## Open Questions

- Should the agent attempt to detect existing Playwright config (`playwright.config.ts`) and reuse it, or always generate a standalone test? Likely: reuse existing config if present, generate minimal config if not
- Should video recording be the default, or should it be configurable between video/screenshots/both? Video is richer but larger files
- For the persistent browser session (manual testing step), should we use `playwright open` or `playwright codegen` (which also records actions)? `codegen` might be more useful since it generates test code the user can keep
- Should there be a timeout for the manual testing step, or does it just wait indefinitely? (Current manual testing guidance waits indefinitely, so probably consistent)

## Related

- Research:
- Feature: feature-29-manual-testing-guidance (predecessor — this extends that pattern with automation)
- Feature: feature-16-ralph-wiggum (autonomous mode — recordings integrate with auto-submit)
- Template: `templates/generic/commands/feature-do.md`
