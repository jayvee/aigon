# Feature: post-review-feedback-injection

## Summary
After a review agent completes its review in autonomous mode (solo), inject a prompt into the still-running implementing agent's tmux session so it can address review feedback before feature-close. This is the default behavior — not optional — because a review without follow-up is an incomplete cycle.

## User Stories
- [ ] As a developer running autonomous mode with a review agent, I want the implementing agent to automatically receive and address review feedback without manual intervention
- [ ] As a developer, I want the full autonomous cycle to be: implement → review → address feedback → close

## Acceptance Criteria
- [ ] After review-complete is signaled in solo autonomous mode, the AutoConductor injects a prompt into the existing implementation agent's tmux session via `tmux send-keys`
- [ ] The injected prompt tells the implementing agent to check and address the review feedback
- [ ] The AutoConductor waits for the implementing agent to finish addressing feedback before proceeding to feature-close
- [ ] If the implementation session no longer exists (edge case), log a warning and proceed to close without injection
- [ ] No accept/reject signal is needed — whatever state the worktree is in when the agent finishes is the final state

## Validation
```bash
node --check aigon-cli.js
npm test
```

## Technical Approach

### Key insight: both sessions stay open
Both the implementation and review tmux sessions remain alive throughout the feature lifecycle — they are only closed when feature-close runs. The implementing agent's CLI (e.g. `claude`) returns to its `>` prompt after finishing its task, so it's sitting there waiting for input. This means we inject directly into the existing session — no need to spawn anything new.

### Architecture
Insert a new step in the AutoConductor `__run-loop` (solo mode) between "review completed" (Step 3) and "feature-close" (Step 4). The full autonomous flow becomes:

```
implement → review → address feedback → close
   Step 1     Step 2    Step 3→3.5       Step 4
```

### New state variables (in the `__run-loop` scope)
```js
let feedbackInjected = false;
let feedbackPolls = 0;
const MAX_FEEDBACK_POLLS = 120; // 60 min at 30s intervals
```

### Modified Step 3 (review completion)
When `reviewCompleted` is detected, instead of falling through to close:

1. Compute the implementing agent's tmux session name using `buildTmuxSessionName()` with the implementing agent (`agentIds[0]`) and `role: 'do'`
2. Verify the session still exists with `tmuxSessionExists()`
3. Inject the review-check prompt via `tmux send-keys -l` (literal mode), followed by a separate `Enter`
4. Set `feedbackInjected = true` and `continue` polling (don't fall through to close)

The injected prompt:
```
The review is complete. Please run /aigon:feature-review-check to check and address the review feedback, then submit your changes with /aigon:feature-submit
```

The `-l` flag is critical — without it, tmux interprets text as key names.

### New Step 3.5 (wait for implementing agent to finish)
After injecting the prompt, poll for the implementing agent to signal completion. The agent will process the feedback and then either:
- The agent-status file updates (the agent runs `/aigon:feature-submit` which calls `agent-status submitted`)
- Or the tmux session exits (shell trap fires `submitted`)

Poll by checking agent-status timestamp — if `updatedAt` is newer than the injection time, the agent has re-submitted. Fall through to close.

Timeout after 60 minutes (same as review timeout).

### Modified Step 4 guard
Add `feedbackDone` to the `readyToClose` condition:
```js
const feedbackDone = !reviewAgent || !feedbackInjected || feedbackAddressed;
const readyToClose = soloReadyToAdvance && effectiveStopAfter === 'close'
    && (!reviewAgent || (reviewStarted && reviewCompleted))
    && feedbackDone;
```

### Why no accept/reject signal
The implementing agent has full autonomy to apply fixes, partially apply them, or disagree and leave things as-is. Whatever state the worktree is in when the agent finishes is the final answer. Adding accept/reject would mean:
- A new signal type in agent-status (`accepted`/`rejected`)
- Branching logic in the AutoConductor for each outcome
- Edge cases (partial acceptance)

This is over-engineering. The agent addresses what it agrees with and moves on.

### tmux send-keys mechanics
- `tmux send-keys -t <session> -l "<text>"` sends literal text (no key-name interpretation)
- `tmux send-keys -t <session> Enter ''` sends the Enter key
- The implementing agent is at its prompt (`>`) waiting for input, so the text is delivered immediately
- This is already proven in the codebase: `ensureAgentSessions()`, `sessions-close`, and dashboard `send-keys` action all use this pattern

### Updated debug log line
Add `feedbackInjected=${feedbackInjected}` to the poll log for visibility.

## Files to modify
- `lib/commands/feature.js` — AutoConductor `__run-loop`, solo mode only (~40 lines added)

## Dependencies
- `buildTmuxSessionName()`, `tmuxSessionExists()`, `runTmux()` — all in `lib/worktree.js`
- `readAgentStatus()` — in `lib/agent-status.js` (already imported)
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
- `lib/worktree.js:757` — `runTmux()`
