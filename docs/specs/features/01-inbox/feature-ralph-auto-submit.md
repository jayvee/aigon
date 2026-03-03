# Feature: ralph-auto-submit

## Summary

When a Ralph loop completes successfully (all validation commands pass), automatically run `feature-submit` without waiting for the user to trigger it manually. This makes Ralph truly autonomous end-to-end: implement → validate → if pass, commit + log + signal done. The user receives a notification (if conductor-daemon is running) and comes back to a fully submitted feature rather than an agent waiting for input.

## User Stories

- [ ] As a developer running agents in Ralph mode, I want to walk away and come back to a submitted feature — not an agent waiting for me to type `/aigon:feature-submit`
- [ ] As a developer, I want Ralph auto-submit to be the default in arena mode since I'm not watching anyway
- [ ] As a developer in solo mode, I want to opt in to auto-submit explicitly since I may want to review before committing

## Acceptance Criteria

- [ ] When Ralph validation passes, the loop automatically runs `aigon feature-submit` logic (commit code, write log, update status to `submitted`) without user intervention
- [ ] New flag `--auto-submit` on `aigon feature-implement --ralph` enables this behaviour (default: off)
- [ ] When arena mode is detected, `--auto-submit` is enabled by default (can be overridden with `--no-auto-submit`)
- [ ] The implementation log is written with a summary of what Ralph attempted and the validation result
- [ ] After auto-submit, the agent exits cleanly — does not wait for further input
- [ ] If `log-status-tracking` is installed, `aigon agent-status submitted` is called as part of auto-submit
- [ ] `node --check aigon-cli.js` passes

## Validation

```bash
node --check aigon-cli.js
```

## Technical Approach

In the Ralph loop in `aigon-cli.js`, after the validation step returns success:

```js
if (validationPassed && autoSubmit) {
    // run the same logic as feature-submit:
    // 1. commit staged changes
    // 2. write/update implementation log
    // 3. aigon agent-status submitted (if available)
    // 4. print "Auto-submitted. Ready for evaluation."
    // 5. exit
}
```

The `--auto-submit` flag is parsed from Ralph args and passed through the loop. Arena detection uses the same worktree count logic as `feature-submit`.

The implementation log for an auto-submitted Ralph run should note: number of iterations, what validation ran, and that it was auto-submitted.

## Dependencies

- Feature: log-status-tracking (optional but integrates cleanly — `submitted` status is set automatically)

## Out of Scope

- Auto-triggering `feature-eval` after all arena agents submit (that's conductor-daemon)
- Auto-merging (user still runs `feature-done` after reviewing)

## Open Questions

- Should `--auto-submit` be the default in solo mode too? Probably not — solo mode implies the user is present and wants to review before committing.

## Related

- Feature: log-status-tracking (sets `submitted` status on auto-submit)
- Feature: conductor-daemon (can detect all agents submitted and notify user)
