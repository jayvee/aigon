# Feature: unified-dashboard-actions

## Summary
Monitor and Pipeline views render entirely different actions for the same feature in the same state. Both should call a single shared action renderer that takes `validActions` from the state machine and produces identical buttons. Also fixes fleet close (missing agent arg), eval-done primary action, and adds adoption options.

## User Stories
- [ ] As a user, I see the same actions for a feature regardless of whether I'm in Monitor or Pipeline view
- [ ] As a user, when eval is done and a winner is picked, "Close & Merge [winner]" is the obvious primary action
- [ ] As a user, when closing a fleet feature from the dashboard, I can choose to adopt improvements from losing agents
- [ ] As a user, I never see a confusing error because the dashboard forgot to pass the winning agent to the close command

## Acceptance Criteria
- [ ] Single `buildFeatureActions(feature, repoPath)` function shared by monitor.js and pipeline.js — returns the same HTML for the same feature state
- [ ] Fleet close action always passes the winning agent to `feature-close <id> <agent>`
- [ ] When `evalStatus === 'pick winner'` and `winnerAgent` exists: primary button is "Close & Merge [winner]", secondary is "Continue Evaluation"
- [ ] When `evalStatus === 'pick winner'`: close modal offers "Close", "Close + Adopt from [agent]", "Close + Adopt all"
- [ ] Monitor dropdown and Pipeline card buttons produce identical action lists for any given feature state
- [ ] All existing Playwright dashboard tests pass
- [ ] Manual test: fleet feature through dashboard from backlog → close works end-to-end without leaving the dashboard

## Validation
```bash
npm test
npm run test:dashboard
```

## Technical Approach
- Extract action rendering from `monitor.js` and `pipeline.js` into a shared `js/actions.js` module
- The module takes a feature object (with `validActions`, `evalStatus`, `winnerAgent`, `agents`, `stage`) and returns action button HTML
- Both views call this module instead of having their own rendering logic
- The state machine already provides `validActions` — this feature is purely view-layer unification
- Close modal enhanced: if feature has multiple agents, show adoption checkboxes alongside the winner picker
- Fleet close: `requestAction('feature-close', [id, winnerAgent, ...adoptFlags], repoPath)`

## Dependencies
- State machine `validActions` (already implemented in features 101-105)

## Out of Scope
- Changing the state machine or manifest logic
- Adding new states or transitions
- Redesigning the dashboard layout
- Eval agent changes (separate feedback item)

## Open Questions
- Should "Close + Adopt" run adoption inline (slow, blocks the dashboard), or spawn a background tmux session for the adoption review?

## Related
- Feedback: `docs/specs/feedback/01-inbox/feedback-2-eval-agent-should-be-able-to-close-feature-and-adopt.md`
- Feedback: `docs/specs/feedback/01-inbox/feedback-3-unified-dashboard-actions-monitor-and-pipeline-diverge.md`
- Also include: move log writing before commit in feature-do template (prevents agents skipping log step)
