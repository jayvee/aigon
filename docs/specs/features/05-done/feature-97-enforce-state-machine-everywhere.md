# Feature: enforce-state-machine-everywhere

## Summary
The state machine (`lib/state-machine.js`) defines stages, transitions, guards, and valid actions — but at least 9 places in the codebase bypass it with ad-hoc logic. This feature deletes all duplicated state logic and makes every code path go through the state machine. The state machine becomes the single source of truth, not a suggestion.

## User Stories
- [ ] As a user, I should never see a notification that doesn't correspond to a valid state transition (e.g., no "ready for eval" on a solo worktree)
- [ ] As a user, every action button in the dashboard should come from the state machine, not hardcoded frontend logic
- [ ] As a developer, I should only need to update `state-machine.js` to change what's valid — not hunt through 5 files

## Acceptance Criteria

### Notifications (dashboard-server.js)
- [ ] `emitNotification('all-submitted', ...)` only fires when `stateMachine.getValidTransitions()` includes a transition that requires `allAgentsSubmitted` guard — not a local reimplementation
- [ ] Remove the inline `namedAgents.length >= 2 && agents.every(...)` check (line 952); replace with state machine call
- [ ] Research "all submitted" notification (line 971) uses the same pattern
- [ ] No notification fires for a state that the state machine says is impossible

### Conductor daemon (infra.js)
- [ ] Remove the duplicate `allSubmittedNotified` tracking (lines 121, 207-218) — dashboard-server handles notifications
- [ ] If conductor needs to detect "all submitted", it imports and calls from state-machine, not inline logic
- [ ] Remove duplicate eval file parsing (lines 540-557) — use same source as dashboard-server

### AIGON server — eval status (dashboard-server.js)
- [ ] Eval status badge (`evalStatus`) derived from state machine context, not hardcoded `stage === 'in-evaluation'` check (line 363)
- [ ] Eval file parsing happens once, in one place, and feeds into state machine context

### Frontend — drag-drop transitions (pipeline.js)
- [ ] Remove hardcoded transition pairs (lines 435-450: `inbox→backlog`, `backlog→in-progress`, etc.)
- [ ] Drag-drop uses `validTargetStages` from server-provided `validActions` to determine which action to dispatch
- [ ] Frontend never checks stage names directly for transition logic

### Frontend — badges and status (monitor.js, pipeline.js)
- [ ] "Ready to synthesize" badge (monitor.js line 131) checks `validActions` for `research-synthesize`, not inline `every(a => a.status === 'submitted')`
- [ ] Eval badge rendering uses server-provided `evalStatus`, not frontend logic

### State machine API additions
- [ ] Export `isFleet(context)` helper — returns true when 2+ non-solo agents exist
- [ ] Export `shouldNotify(entityType, stage, context, notificationType)` — central authority for when notifications fire
- [ ] All guards (`allAgentsSubmitted`, etc.) are importable and used everywhere instead of reimplemented

### Worktree orphan detection (worktree.js)
- [ ] Replace hardcoded `stage === 'done'` / `stage === 'paused'` (line 249-251) with `getAvailableActions()` — orphaned if no actions available

### General
- [ ] Zero hardcoded stage name comparisons outside `state-machine.js` (grep for `=== 'in-evaluation'`, `=== 'backlog'`, etc. in non-state-machine files — display/rendering uses are OK, logic branching is not)
- [ ] `node -c` passes on all modified files
- [ ] Dashboard restart after changes, verify no spurious notifications on solo worktree

## Validation
```bash
node -c lib/state-machine.js
node -c lib/dashboard-server.js
node -c lib/commands/infra.js
node -c lib/worktree.js
node -c templates/dashboard/js/pipeline.js
node -c templates/dashboard/js/monitor.js
```

## Technical Approach

### Phase 1: Extend state machine API
Add to `lib/state-machine.js`:
- `isFleet(context)` — `context.agents.filter(a => a.id !== 'solo').length >= 2`
- `shouldNotify(entityType, stage, context, eventType)` — checks if a notification-worthy transition is possible from current state
- Ensure `allAgentsSubmitted()` is exported and documented

### Phase 2: Fix notifications (dashboard-server.js + infra.js)
- Replace inline checks with `stateMachine.shouldNotify('feature', stage, smContext, 'all-submitted')`
- Remove conductor daemon's parallel notification tracking — let the AIGON server notification path be the single notification authority
- If conductor still needs awareness, it reads from dashboard, not reimplements

### Phase 3: Fix frontend (pipeline.js, monitor.js)
- Drag-drop: on drop, look up the matching action in `feature.validActions` by target stage, dispatch that action
- Badges: derive from `validActions` presence, not inline agent status checks
- Eval badge: trust server-provided `evalStatus`, no frontend logic

### Phase 4: Fix worktree.js orphan detection
- Replace hardcoded stage checks with `getAvailableActions()` — no actions = orphaned

### Principle
After this feature, the only file that knows about stage names and transition rules is `state-machine.js`. Everything else asks it.

## Dependencies
- `lib/state-machine.js` — needs new exports
- All consuming files need to import from state-machine instead of reimplementing

## Out of Scope
- Rewriting the state machine itself (it's correct, just underused)
- Adding new states or transitions
- Dashboard UI redesign

## Open Questions
- Should the conductor daemon be removed entirely in favor of dashboard-server's poll loop? They do the same thing.

## Related
- `lib/state-machine.js` — source of truth
- `lib/dashboard-server.js:935-977` — notification violations
- `lib/commands/infra.js:115-220` — conductor daemon duplication
- `templates/dashboard/js/pipeline.js:435-450` — hardcoded drag-drop transitions
- Feature 62 (unified state machine) — original feature that created the state machine
