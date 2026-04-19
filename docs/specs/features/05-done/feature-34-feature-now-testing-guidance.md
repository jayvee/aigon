# Feature: feature-now-testing-guidance

## Summary

Feature 29 introduced profile-aware `{{MANUAL_TESTING_GUIDANCE}}` (driven by `templates/profiles/*/manual-testing-guidance.md` and `MANUAL_TESTING_GUIDANCE` in `getProfilePlaceholders()` in `lib/profile-placeholders.js`). Worktree flows consume that content via `{{TESTING_STEPS_SECTION}}` inside `templates/generic/commands/feature-do.md`. The fast-track template `templates/generic/commands/feature-now.md` previously had only a thin “run tests” step—agents using `/afn` did not get the same structured manual-testing block. This feature adds `{{MANUAL_TESTING_GUIDANCE}}` to `feature-now.md` so fast-track matches the intent of the manual-testing guidance work. A separate AC called for `aigon agent-status waiting` before the session end; that signal is **not** present in the current `feature-now.md` template (see Acceptance Criteria).

## User Stories

- [x] As a user who fast-tracks a feature with `/afn`, the agent receives expanded profile guidance to start the dev server (when applicable), open it, and present a numbered manual testing checklist derived from acceptance criteria—without the user having to ask
- [x] As a user on a non-web project, the agent still receives acceptance-criteria-driven checklist instructions when the profile’s `manual-testing-guidance.md` is non-empty and testing is not in “light” skip mode
- [ ] As a user relying on Conductor, the agent signals `waiting` via `aigon agent-status waiting` before the session-complete STOP in feature-now mode *(not implemented in `feature-now.md` as of last spec review—agents still run `aigon agent-status submitted` immediately after the manual-testing block; consider a follow-up if dashboard “waiting” is required for fast-track)*

## Acceptance Criteria

- [x] `feature-now.md` Step 5 includes `{{MANUAL_TESTING_GUIDANCE}}` (replacing the prior bare dev-server-only wording)
- [ ] `feature-now.md` includes `aigon agent-status waiting` before the STOP line *(deferred: current template has `aigon agent-status submitted` in Step 5 and goes to Step 7 STOP without a `waiting` transition)*
- [x] For web/api profiles, expanded profile content instructs: start dev server → open browser → present checklist (via `templates/profiles/web|api/manual-testing-guidance.md`)
- [x] For non-web profiles, expanded profile content instructs checklist-only paths where applicable (via the matching profile file under `templates/profiles/`)
- [x] `node -c aigon-cli.js` passes with no syntax errors
- [x] Running `aigon update` syncs template changes to agent working copies without errors

## Validation

```bash
node -c aigon-cli.js
rg -n 'MANUAL_TESTING_GUIDANCE' templates/generic/commands/feature-now.md
```

## Technical Approach

Changes to `templates/generic/commands/feature-now.md`:

1. In **Step 5: Test**, include `{{MANUAL_TESTING_GUIDANCE}}` after `{{TESTING_RUN_SECTION}}` so the placeholder expands with the active profile’s `manualTestingGuidance` file (empty when `directives.testing` and `directives.logging` are both `skip`—same as other templates using profile placeholders).

2. **Waiting signal (original intent):** add an `aigon agent-status waiting` block after the checklist and before the final “implementation complete” / STOP section if Conductor or the dashboard must show “waiting” before `submitted`. The shipped template currently runs `aigon agent-status submitted` directly after the manual-testing block; implementers should confirm product expectations before adding `waiting` without duplicating status churn.

The `{{MANUAL_TESTING_GUIDANCE}}` placeholder is defined in `PROFILE_PRESETS` / profile string files and injected by `getProfilePlaceholders()`—no CLI logic changes were required for the placeholder expansion itself.

After template changes, run `aigon update` to sync working copies.

## Dependencies

- Feature 29 (manual-testing-guidance) — profile files and `MANUAL_TESTING_GUIDANCE` / testing-step pipeline
- `aigon update` to regenerate working copies

## Out of Scope

- Changes to `feature-do.md` testing sections beyond what Feature 29 already established
- Changes to profile preset *content* unless a gap is found in a specific profile file
- Ralph mode (uses automated validation, not manual)

## Open Questions

- Should fast-track (`feature-now`) ever call `aigon agent-status waiting`, or is immediate `submitted` after manual testing the desired UX? (Unresolved; affects deferred AC above.)

## Related

- Feature: 29 (manual-testing-guidance)
- Template: `templates/generic/commands/feature-now.md`
- Worktree template reference: `templates/generic/commands/feature-do.md` (`{{TESTING_STEPS_SECTION}}` embeds manual testing steps for non–fast-track flows)
