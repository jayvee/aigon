# Feature: workflow-engine-full-cutover

## Summary

Delete the legacy state machine, manifest system, and all four bridge modules. Make the workflow-core engine the only state system. No migration path, no feature flags, no backward compat. Clean cut.

## Acceptance Criteria

- [ ] Delete `lib/state-machine.js`
- [ ] Delete `lib/manifest.js`
- [ ] Delete `lib/workflow-close.js`, `lib/workflow-start.js`, `lib/workflow-eval.js`, `lib/workflow-pause.js`
- [ ] All commands call engine methods directly
- [ ] Dashboard and board read exclusively from engine snapshots
- [ ] No `requestTransition()` calls remain anywhere
- [ ] No `workflow.*Engine` feature flags remain
- [ ] Agent status files (`.aigon/state/feature-{id}-{agent}.json`) still work — agents write these
- [ ] All tests pass or are rewritten
- [ ] Net deletion: ~2,600 lines

## Validation

```bash
node --check lib/commands/feature.js
node --check lib/dashboard-server.js
npm test
```

## Technical Approach

1. Replace all bridge calls with direct `engine.*` calls in `lib/commands/feature.js`
2. Replace all `requestTransition()` calls with engine methods
3. Delete the four bridge modules
4. Delete `lib/state-machine.js` and `lib/manifest.js` (keep `writeAgentStatusAt`/`readAgentStatus` — move to a small `lib/agent-status.js`)
5. Remove dual-read logic in dashboard-server.js and board.js — always use snapshots
6. Remove all feature flag checks (`workflow.closeEngine`, etc.)
7. Delete stale `.aigon/state/feature-{id}.json` coordinator manifests from all repos

## Dependencies

- None — do this now

## Out of Scope

- Projector/machine merge (follow-up)
- Effect system simplification (follow-up)
- Research workflow migration (follow-up)
