# Feature: post-review-feedback-injection

## Summary
After a review agent completes its review in autonomous mode (solo), inject a prompt into the implementing agent's tmux session so it can address the review feedback before feature-close. This is the default behavior — not optional — because a review without follow-up is an incomplete cycle.

## User Stories
- [x] As a developer running autonomous mode with a review agent, I want the implementing agent to automatically receive and address review feedback without manual intervention
- [x] As a developer, I want the full autonomous cycle to be: implement → review → address feedback → close

## Acceptance Criteria
- [x] After review-complete is signaled in solo autonomous mode, the AutoConductor injects a prompt into the implementing agent's tmux session
- [x] The injected prompt tells the implementing agent to check and address the review feedback
- [x] The AutoConductor waits for the implementing agent to finish addressing feedback before proceeding to feature-close
- [x] The implementing agent's session must exist and be at a prompt for injection to work
- [x] If the implementing agent's session no longer exists, log an error and proceed to close without injection

## Validation
```bash
node --check aigon-cli.js
npm test
```

## Technical Approach
Insert a new step in the AutoConductor `__run-loop` (solo mode) between "review completed" and "feature-close":

1. After `reviewCompleted` is detected, compute the implementing agent's tmux session name using `buildTmuxSessionName()`
2. Verify the session still exists with `tmuxSessionExists()`
3. Use `tmux send-keys -t <session> -l "<prompt>" && tmux send-keys -t <session> Enter` to inject a review-check prompt
4. Poll for the implementing agent to signal `submitted` again (re-enters ready state) before proceeding to close
5. Use the existing `agent-status` mechanism — the implementing agent's shell trap will fire `submitted` when it exits after addressing feedback

Key: use `-l` flag on send-keys to send literal text (avoids tmux key-name interpretation).

## Dependencies
- Existing tmux session management (`lib/worktree.js`)
- Existing AutoConductor `__run-loop` in `lib/commands/feature.js`
- Existing `agent-status` and `review-state` mechanisms

## Out of Scope
- Fleet mode (only solo mode has the review → implement feedback loop)
- Making this behavior optional (it's always-on for autonomous+review)
- Changing the review agent's behavior

## Open Questions
- None

## Related
- `lib/commands/feature.js` — AutoConductor `__run-loop`
- `lib/worktree.js` — tmux session management, `buildTmuxSessionName`, `runTmux`
