# Feature: feature-now-testing-guidance

## Summary

Feature 29 added a `{{MANUAL_TESTING_GUIDANCE}}` placeholder to `feature-implement.md` so arena/worktree agents proactively start the dev server, open it, and present a manual testing checklist before stopping. However `feature-now.md` (the solo fast-track template) still has only a bare "Start the dev server if needed" bullet — agents using `/afn` never get the structured guidance. This feature extends the same profile-aware manual testing guidance to `feature-now.md` and ensures `aigon agent-status waiting` is also signalled there.

## User Stories

- [ ] As a user who fast-tracks a feature with `/afn`, the agent starts the dev server, opens it in the browser, and presents a numbered manual testing checklist — without me having to ask
- [ ] As a user on a non-web project, the agent still presents the acceptance-criteria-driven checklist even without a dev server
- [ ] As a user relying on Conductor, the agent correctly signals `waiting` status via `aigon agent-status waiting` before stopping in feature-now mode

## Acceptance Criteria

- [ ] `feature-now.md` Step 5 includes `{{MANUAL_TESTING_GUIDANCE}}` (replacing the bare "Start the dev server if needed" bullet)
- [ ] `feature-now.md` includes `aigon agent-status waiting` before the STOP/WAIT line
- [ ] For web/api profiles, the expanded template instructs: start dev server → open browser → present checklist
- [ ] For non-web profiles, the expanded template instructs: present checklist only
- [ ] `node -c aigon-cli.js` passes with no syntax errors
- [ ] Running `aigon update` syncs the changes to working copies without errors

## Validation

```bash
node -c aigon-cli.js
```

## Technical Approach

Two changes to `templates/generic/commands/feature-now.md`:

1. Replace Step 5's bare bullet list with `{{MANUAL_TESTING_GUIDANCE}}` (the placeholder already expands correctly for all profiles)
2. Add `aigon agent-status waiting` block before the STOP/WAIT line

The `{{MANUAL_TESTING_GUIDANCE}}` placeholder is already defined in `PROFILE_PRESETS` and injected by `getProfilePlaceholders()` — no CLI changes needed.

After template changes, run `aigon update` to sync working copies.

## Dependencies

- Feature 29 (manual-testing-guidance) — `{{MANUAL_TESTING_GUIDANCE}}` placeholder already in place
- `aigon update` command to regenerate working copies

## Out of Scope

- Changes to `feature-implement.md` (already has the placeholder)
- Changes to profile preset content (already correct)
- Ralph mode (uses automated validation, not manual)

## Open Questions

-

## Related

- Feature: 29 (manual-testing-guidance — added placeholder to feature-implement.md)
- Template: `templates/generic/commands/feature-now.md`
