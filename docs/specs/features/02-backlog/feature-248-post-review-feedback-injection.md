# Feature: post-review-feedback-injection

## Summary
After a review agent completes its review in autonomous mode (solo), spawn a new implementation session and inject a prompt so the implementing agent can address review feedback before feature-close. This is the default behavior — not optional — because a review without follow-up is an incomplete cycle.

## User Stories
- [ ] As a developer running autonomous mode with a review agent, I want the implementing agent to automatically receive and address review feedback without manual intervention
- [ ] As a developer, I want the full autonomous cycle to be: implement → review → address feedback → close

## Acceptance Criteria
- [ ] After review-complete is signaled in solo autonomous mode, the AutoConductor spawns a new `do` session for the implementing agent
- [ ] A review-check prompt is injected via `tmux send-keys` telling the agent to check and address the review feedback
- [ ] The AutoConductor waits for the feedback session to exit before proceeding to feature-close
- [ ] If no worktree exists (edge case), log a warning and proceed to close without injection
- [ ] If the feedback session fails to start, log a warning and proceed to close
- [ ] No accept/reject signal is needed — whatever state the worktree is in when the session exits is the final state

## Validation
```bash
node --check aigon-cli.js
npm test
```

## Technical Approach

### Key insight: the original implementation session is already dead
By the time the review completes, the implementing agent's tmux session has already exited (that's what triggered `allReady` in the first place). So this is NOT injecting into an existing session — it's spawning a fresh one.

### Architecture
Insert a new step in the AutoConductor `__run-loop` (solo mode) between "review completed" (Step 3) and "feature-close" (Step 4). The full autonomous flow becomes:

```
implement → review → address feedback → close
   Step 1     Step 2    Step 3→3.5       Step 4
```

### New state variables (in the `__run-loop` scope)
```js
let feedbackInjected = false;
let feedbackSessionDone = false;
let expectedFeedbackSessionName = null;
let feedbackPolls = 0;
const MAX_FEEDBACK_POLLS = 120; // 60 min at 30s intervals
```

### Modified Step 3 (review completion)
When `reviewCompleted` is detected, instead of falling through to close:

1. Look up the implementing agent (`agentIds[0]`) and its worktree via `filterByFeatureId(findWorktrees(), featureNum)`
2. Build the tmux session name using `buildTmuxSessionName()` with `role: 'do'`
3. Kill any leftover session with the same name
4. Spawn a fresh `do` session via `createDetachedTmuxSession()` with `buildAgentCommand(wt, 'do')`
5. Inject the review-check prompt via `tmux send-keys -l` (literal mode to avoid key-name interpretation), followed by a separate `Enter`
6. Set `feedbackInjected = true` and `continue` polling (don't fall through to close)

The injected prompt:
```
The review is complete. Please run /aigon:feature-review-check to check and address the review feedback, then submit your changes with /aigon:feature-submit
```

The `-l` flag is critical — without it, tmux interprets text as key names.

### New Step 3.5 (wait for feedback session)
Poll for the feedback tmux session to exit:
- If session is gone → set `feedbackSessionDone = true`, fall through to close
- If timeout (60 min) → error out with manual close instructions
- Otherwise → sleep and continue polling

### Modified Step 4 guard
Add `feedbackDone` to the `readyToClose` condition:
```js
const feedbackDone = !reviewAgent || !feedbackInjected || feedbackSessionDone;
const readyToClose = soloReadyToAdvance && effectiveStopAfter === 'close'
    && (!reviewAgent || (reviewStarted && reviewCompleted))
    && feedbackDone;
```

### Why no accept/reject signal
The implementing agent has full autonomy to apply fixes, partially apply them, or disagree and leave things as-is. Whatever state the worktree is in when the agent exits is the final answer. Adding accept/reject would mean:
- A new signal type in agent-status (`accepted`/`rejected`)
- Branching logic in the AutoConductor for each outcome
- Edge cases (partial acceptance)

This is over-engineering. The existing `submitted` signal (fired by shell trap on exit) is sufficient.

### tmux send-keys mechanics
- `tmux send-keys -t <session> -l "<text>"` sends literal text (no key-name interpretation)
- `tmux send-keys -t <session> Enter ''` sends the Enter key
- Text sent before the agent CLI starts reading stdin will buffer in tmux and be delivered when the prompt appears
- This is already proven in the codebase: `ensureAgentSessions()`, `sessions-close`, and dashboard `send-keys` action all use this pattern

### Updated debug log line
Add `feedbackInjected=${feedbackInjected}` to the poll log for visibility.

## Files to modify
- `lib/commands/feature.js` — AutoConductor `__run-loop`, solo mode only (~60 lines added)

## Dependencies
- `buildTmuxSessionName()`, `tmuxSessionExists()`, `createDetachedTmuxSession()`, `runTmux()`, `buildAgentCommand()` — all in `lib/worktree.js`
- `filterByFeatureId()`, `findWorktrees()` — already imported in feature.js
- `featureReviewState` — already imported in feature.js
- No new modules or dependencies needed

## Out of Scope
- Fleet mode (only solo mode has the review → implement feedback loop)
- Making this behavior optional (it's always-on for autonomous+review)
- Changing the review agent's behavior
- Accept/reject signaling (see "Why no accept/reject signal" above)

## Open Questions
- None

## Related
- `lib/commands/feature.js:2470` — AutoConductor `__run-loop`
- `lib/worktree.js:508` — `buildTmuxSessionName()`
- `lib/worktree.js:777` — `createDetachedTmuxSession()`
- `lib/worktree.js:757` — `runTmux()`
- `lib/worktree.js:365` — `buildAgentCommand()`
