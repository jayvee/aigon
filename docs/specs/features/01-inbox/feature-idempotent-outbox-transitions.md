# Feature: idempotent-outbox-transitions

## Summary
Refactor the state machine from advisory to mandatory gatekeeper, add an outbox pattern for crash-safe side effects, and make all transition side effects idempotent. Absorbs the original state-machine-gatekeeper, outbox-side-effects, and idempotent-transitions features.

## User Stories
- [ ] As a user, when `feature-setup` crashes after creating a worktree but before moving the spec, re-running the command completes the remaining steps instead of erroring
- [ ] As a user, when `feature-close` is interrupted mid-merge, re-running it picks up where it left off
- [ ] As a developer, I cannot accidentally bypass the state machine — all transitions go through `requestTransition()`

## Acceptance Criteria
- [ ] `requestTransition(featureId, action)` validates the action, writes new state + pending side effects to manifest, returns side effects list
- [ ] All CLI commands (`feature-setup`, `feature-close`, `feature-eval`, `feature-submit`) use `requestTransition()` instead of direct file moves
- [ ] Pending operations stored in manifest `pending` array: `["move-spec", "create-worktree-cc", "init-log-cc"]`
- [ ] Each side effect removed from `pending` on success
- [ ] On next command invocation, if `pending` is non-empty, remaining operations are replayed
- [ ] Every side effect is idempotent: move-spec (no-op if already there), create-worktree (no-op if exists), write-log (no-op if exists), delete-worktree (no-op if gone)
- [ ] Invalid transitions (e.g., closing a feature still in inbox) return clear error messages
- [ ] `npm test` passes; `node -c lib/state-machine.js` passes

## Validation
```bash
node -c lib/state-machine.js
node -c lib/commands/feature.js
npm test
```

## Technical Approach
- Extend `lib/state-machine.js` with `requestTransition()` that reads manifest, validates, writes atomically
- Each command refactored to: acquire lock → requestTransition → execute pending ops → release lock
- Side effects wrapped in idempotent helpers (check precondition before executing)
- Outbox replay: at command start, check manifest for non-empty `pending`, complete outstanding ops first

## Dependencies
- state-manifest-core (needs manifest read/write API and locking)

## Out of Scope
- Agent-side status writes (that's agent-status-out-of-worktree)
- Dashboard reads (that's dashboard-manifest-reader)
- Desync detection (that's state-reconciliation)

## Open Questions
- Should `requestTransition()` support dry-run mode for testing?

## Related
- Research: `docs/specs/research-topics/04-done/research-14-unified-feature-state.md`
- Findings: `docs/specs/research-topics/logs/research-14-cc-findings.md` (Part 2: failure scenarios F1-F11)
- Depends on: state-manifest-core
