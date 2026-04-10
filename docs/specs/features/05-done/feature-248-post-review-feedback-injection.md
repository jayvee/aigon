# Feature: post-review-feedback-injection

## Summary
After a review agent completes its review in autonomous mode (solo), inject a prompt into the still-running implementing agent's tmux session so it can address review feedback before feature-close. Also update the `feature-review-check` command template to give the implementing agent explicit authority to revert review changes it disagrees with. This is the default behavior — not optional — because a review without follow-up is an incomplete cycle.

## User Stories
- [ ] As a developer running autonomous mode with a review agent, I want the implementing agent to automatically receive and address review feedback without manual intervention
- [ ] As a developer, I want the full autonomous cycle to be: implement → review → address feedback → close
- [ ] As a developer, I want the implementing agent to have full authority to accept, modify, or revert review changes — it owns the code

## Acceptance Criteria
- [ ] After review-complete is signaled in solo autonomous mode, the AutoConductor injects a prompt into the existing implementation agent's tmux session via `tmux send-keys`
- [ ] The injected prompt tells the implementing agent to check and address the review feedback
- [ ] The AutoConductor waits for the implementing agent to finish addressing feedback before proceeding to feature-close
- [ ] If the implementation session no longer exists (edge case), log a warning and proceed to close without injection
- [ ] No accept/reject signal is needed — whatever state the worktree is in when the agent finishes is the final state
- [ ] The `feature-review-check` template is updated to give the implementing agent explicit authority to revert review commits it disagrees with (not just challenge and wait)

## Validation
```bash
node --check aigon-cli.js
npm test
```

## Technical Approach

### Part 1: Update `feature-review-check` template

**File:** `templates/generic/commands/feature-review-check.md`

The current Step 4 "Challenge" option says: **"Do NOT revert commits on your own — the user makes that call."** This was written for the human-in-the-loop case. In autonomous mode there is no user to decide.

Update Step 4 to give the implementing agent explicit authority:

- **Accept** — unchanged
- **Challenge → Revert** — rename this option. If the implementing agent disagrees with a review change, it has the right to `git revert <sha>` the reviewer's commit(s) and commit the revert with a `revert(review):` prefix explaining why. The implementing agent owns the code — the reviewer is advisory.
- **Modify** — unchanged, but clarify that this includes reverting individual hunks and re-applying them differently

Add a clear principle at the top of Step 4: **"You are the author of this code. The reviewer's changes are suggestions. You have full authority to accept, modify, or revert any review commit."**

After running `install-agent`, the updated template will be synced to all agent working copies.

### Part 2: AutoConductor feedback injection

#### Key insight: both sessions stay open
Both the implementation and review tmux sessions remain alive throughout the feature lifecycle — they are only closed when feature-close runs. The implementing agent's CLI (e.g. `claude`) returns to its `>` prompt after finishing its task, so it's sitting there waiting for input. This means we inject directly into the existing session — no need to spawn anything new.

#### Architecture
Insert a new step in the AutoConductor `__run-loop` (solo mode) between "review completed" (Step 3) and "feature-close" (Step 4). The full autonomous flow becomes:

```
implement → review → address feedback → close
   Step 1     Step 2    Step 3→3.5       Step 4
```

#### New state variables (in the `__run-loop` scope)
```js
let feedbackInjected = false;
let feedbackAddressed = false;
let feedbackPolls = 0;
const MAX_FEEDBACK_POLLS = 120; // 60 min at 30s intervals
```

#### New agent-status signal: `feedback-addressed`
Added to `validStatuses` in `lib/commands/misc.js`. The implementing agent fires this after it has finished addressing review feedback. No engine signal mapping needed — the AutoConductor polls the agent-status file directly.

#### Modified Step 3 (review completion)
When `reviewCompleted` is detected, instead of falling through to close:

1. Compute the implementing agent's tmux session name using `buildTmuxSessionName()` with the implementing agent (`agentIds[0]`) and `role: 'do'`
2. Verify the session still exists with `tmuxSessionExists()`
3. Build an agent-specific prompt using `loadAgentConfig(implAgent).placeholders.CMD_PREFIX` (so non-CC agents get the right command form)
4. Inject the prompt via `tmux send-keys -l` (literal mode), followed by a separate `Enter`
5. Set `feedbackInjected = true` and `continue` polling (don't fall through to close)

The injected prompt (agent-specific `CMD_PREFIX`):
```
The review is complete. Please run <CMD_PREFIX>feature-review-check <ID> to check and address the review feedback, then signal completion with: aigon agent-status feedback-addressed
```

The `-l` flag is critical — without it, tmux interprets text as key names.

If the implementation session no longer exists (edge case), log a warning and set both `feedbackInjected` and `feedbackAddressed` to skip straight to close.

#### New Step 3.5 (wait for implementing agent to signal)
After injecting the prompt, poll for the `feedback-addressed` signal. The agent addresses review feedback and then fires `aigon agent-status feedback-addressed`.

Detection: check `implStatus.status === 'feedback-addressed'` via `readAgentStatus()`.

Fallback: if the tmux session exits before signaling (shell trap fires `submitted`), treat feedback as addressed and proceed.

Timeout after 60 minutes (120 polls at 30s intervals, same as review timeout).

#### Modified Step 4 guard
Add `feedbackDone` to the `readyToClose` condition:
```js
const feedbackDone = !reviewAgent || !feedbackInjected || feedbackAddressed;
const readyToClose = soloReadyToAdvance && effectiveStopAfter === 'close'
    && (!reviewAgent || (reviewStarted && reviewCompleted))
    && feedbackDone;
```

#### Updated debug log line
Add `feedbackInjected=${feedbackInjected}` to the poll log for visibility.

## Files modified
- `templates/generic/commands/feature-review-check.md` — Step 4 rewrite: grant revert authority (prior commit `307b418f`)
- `lib/commands/feature.js` — AutoConductor `__run-loop`, solo mode: feedback injection + polling (~40 lines added)
- `lib/commands/misc.js` — added `feedback-addressed` to `validStatuses`

## Out of Scope
- Fleet mode (only solo mode has the review → implement feedback loop)
- Making this behavior optional (it's always-on for autonomous+review)
- Changing the review agent's behavior

## Related
- `templates/generic/commands/feature-review-check.md` — current review-check template
- `lib/commands/feature.js:2470` — AutoConductor `__run-loop`
- `lib/commands/misc.js:35` — `validStatuses` array
- `lib/worktree.js:508` — `buildTmuxSessionName()`
