# Feature: manual-testing-guidance

## Summary

Before an agent submits a completed feature implementation (in worktree or arena mode), it should proactively set up for manual user validation rather than just stopping and waiting. Currently agents stop at the end of Step 4 and the user must repeatedly ask for dev server startup, browser launch, and a list of manual test steps. This feature adds a "Manual Testing Guidance" step that instructs agents to: (1) start the dev server if applicable, (2) open it in the browser, and (3) generate and display a numbered list of manual test scenarios derived from the spec's Acceptance Criteria — all before the STOP/WAIT point.

## User Stories

- [ ] As a user in arena mode with 3 agents, when each agent finishes implementing, I can immediately start manual testing without having to ask each agent to start the dev server and list testing steps
- [ ] As a user reviewing a completed feature, I receive a clear numbered checklist of what to manually verify based on the spec's acceptance criteria
- [ ] As a user with a non-web project (library, iOS), the agent still generates relevant manual testing guidance without attempting to start a dev server

## Acceptance Criteria

- [ ] `feature-implement.md` includes a new Step 4.5 (or equivalent) that agents execute before the STOP/WAIT point
- [ ] For ALL profiles: agents generate and display a numbered manual testing checklist derived from the spec's Acceptance Criteria
- [ ] For web and api profiles: agents additionally run `aigon dev-server start` then `aigon dev-server open` before presenting the checklist
- [ ] For profiles without a dev server (ios, android, library, generic): no dev server commands are issued, but the checklist is still generated
- [ ] The guidance is profile-conditional via a new `{{MANUAL_TESTING_GUIDANCE}}` placeholder (like `WORKTREE_TEST_INSTRUCTIONS`)
- [ ] The checklist instructs the agent to map each acceptance criterion to one or more testable steps (not just copy the criteria verbatim)
- [ ] This step appears in worktree mode (solo worktree and arena); solo mode gets a lighter-weight variant

## Validation

```bash
node -c aigon-cli.js
```

## Technical Approach

### New placeholder: `MANUAL_TESTING_GUIDANCE`

Add `manualTestingGuidance` to each profile preset in `PROFILE_PRESETS` (aigon-cli.js ~line 223). Inject it as `MANUAL_TESTING_GUIDANCE` in `getProfilePlaceholders()` (~line 1124).

**Web profile content:**
```
### Step 4.5: Set up for manual review

1. Start your dev server:
   ```bash
   aigon dev-server start
   ```
2. Open it in the browser:
   ```bash
   aigon dev-server open
   ```
3. Based on the spec's **Acceptance Criteria**, generate and display a numbered list of manual test scenarios. For each criterion, write one or more concrete steps the user can follow to verify it (e.g. "Navigate to /settings → click Save without filling required fields → verify error message appears"). Present this as a **Manual Testing Checklist** block.

Then **STOP and WAIT** for the user to complete testing.
```

**API profile content:** Similar — start/open dev server, then generate checklist of curl commands or UI interaction steps per acceptance criterion.

**iOS / Android profile content:** Skip dev server commands. Instruct agent to build and install on simulator/device (per AGENTS.md), then generate a numbered acceptance-criteria-driven checklist.

**Library / Generic profile content:** No dev server. Generate a numbered checklist of manual test scenarios from acceptance criteria (may overlap with automated tests but phrased for human verification).

### Template change: `feature-implement.md`

In Step 4 (Worktree Mode section), add `{{MANUAL_TESTING_GUIDANCE}}` between the existing test instructions and the STOP line:

```markdown
### Worktree Mode (solo worktree or arena)
{{WORKTREE_TEST_INSTRUCTIONS}}
{{AGENT_DEV_SERVER_NOTE}}
> **Project-specific steps?** Check your root instructions file (e.g. AGENTS.md) for test commands.

{{MANUAL_TESTING_GUIDANCE}}

**STOP and WAIT for user confirmation before proceeding** - do NOT continue until the user confirms testing is complete
```

For Solo Mode (branch), add a lighter instruction: after running tests, generate the same manual testing checklist and present it to the user before asking them to verify.

### Checklist generation guidance (in the placeholder text)

The placeholder text should instruct the agent to:
1. Re-read the spec's Acceptance Criteria section
2. For each criterion, write 1–3 concrete, human-executable steps
3. Group them under a `## Manual Testing Checklist` header
4. Note any prerequisites (must be logged in, feature flag needed, etc.)

This is AI-generated from context — no new CLI commands needed for the checklist itself.

## Dependencies

- Profile placeholder system (already in place: `WORKTREE_TEST_INSTRUCTIONS`, `STOP_DEV_SERVER_STEP`)
- `aigon dev-server start` / `aigon dev-server open` commands (already working)
- `feature-implement.md` template (source of truth in `templates/generic/commands/`)
- After changes: run `aigon install-agent cc` (and other agents) to sync working copies

## Out of Scope

- Automatically running automated tests (that's `WORKTREE_TEST_INSTRUCTIONS`)
- Modifying `feature-submit.md` — this happens before submit, not during
- Ralph mode — autonomous validation is handled separately via `## Validation` in the spec
- Generating test code — this is manual steps only

## Open Questions

- Should solo mode (branch) also get the full dev-server start + open guidance, or just the checklist? (Likely yes for web/api; the dev server start line in solo mode currently says "Start the dev server if needed")

## Related

- Research:
- Feature: dev-server (already implemented)
- Template: `templates/generic/commands/feature-implement.md`
