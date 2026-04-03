# Feature: autonomous-solo-review-step

## Summary

Extend the solo AutoConductor loop to include an optional review step between implementation and close. When enabled, after the implementing agent submits, AutoConductor spawns a second agent in a review session (`feature-review`), waits for it to complete, then either stops or auto-closes depending on `--stop-after`. This enables a fully hands-off solo workflow: implement with agent A → review with agent B → close.

## User Stories

- [ ] As a user, I can run `aigon feature-autonomous-start 42 cc --review-agent=gg --stop-after=close` and have cc implement, gg review, and the feature auto-close without any manual steps.
- [ ] As a user, I can run with `--stop-after=review` to have the AutoConductor stop after the review session starts, so I can read the review output before deciding to close.
- [ ] As a user, if no `--review-agent` is provided, autonomous mode skips the review step (existing behaviour preserved).

## Acceptance Criteria

- [ ] `--review-agent=<agent>` flag accepted by `feature-autonomous-start` outer launcher and passed through to `__run-loop`
- [ ] `--stop-after` gains a new valid value: `review` (valid values become: `implement`, `review`, `close`)
- [ ] After implementing agent submits (allReady=true), AutoConductor spawns a `feature-review` tmux session using `buildAgentCommand(..., 'review')` with the review agent
- [ ] AutoConductor waits for the review session to start (tmux session exists) before advancing
- [ ] `--stop-after=review`: AutoConductor exits after the review session starts, printing next-step hint
- [ ] `--stop-after=close`: AutoConductor waits for the review session to exit, then calls `feature-close` directly
- [ ] Review session is named with role `review` using `buildTmuxSessionName` (e.g. `brewboard-f42-review-gg-my-feature`)
- [ ] If `--review-agent` is the same as the implementing agent, emit a warning but proceed
- [ ] AutoConductor kills its own session after finishing (consistent with existing exit paths)
- [ ] `feature-autonomous-start status <id>` output includes review session state when active

## Validation

```bash
node -c lib/commands/feature.js
node -c lib/worktree.js
```

## Technical Approach

All changes are in `lib/commands/feature.js` within the `feature-autonomous-start` handler.

**Outer launcher** (`feature-autonomous-start <id> <agent>`):
- Accept `--review-agent=<agent>` option; validate against `availableAgents`
- Pass `--review-agent=<agent>` into the `loopCmdParts` array
- Solo-only: `--review-agent` is ignored (with warning) in Fleet mode since Fleet has its own eval/close path

**`__run-loop`** (solo branch, i.e. `!isFleet`):
- Parse `--review-agent` from options
- `--stop-after=review` is only valid when `--review-agent` is set; otherwise reject with error
- Add state variables: `reviewTriggered`, `reviewStarted`, `expectedReviewSessionName`, `reviewClosePolls`, `MAX_REVIEW_CLOSE_POLLS`
- After `allReady=true` and `effectiveStopAfter !== 'implement'`:
  - If `reviewAgent` set and `!reviewTriggered`: spawn review session via `buildAgentCommand({agent: reviewAgent, ...}, 'review')` + `createDetachedTmuxSession`
  - Wait for review session to appear in tmux list → `reviewStarted = true`
  - If `effectiveStopAfter === 'review'`: kill own session and return
  - If `effectiveStopAfter === 'close'`: wait for review session to exit → call `runAigonCliCommand(['feature-close', featureNum])`
- If no `reviewAgent`: preserve current behaviour (allReady → feature-close directly)

**Session naming**: use existing `buildTmuxSessionName(featureNum, reviewAgent, { role: 'review', desc, repo })`

**`--stop-after` normalization** (outer launcher, solo):
- `eval` → `close` (existing, preserved)
- `review` → only valid when `--review-agent` is set; emit error otherwise

## Dependencies

- No feature dependencies — all changes are self-contained in `feature-autonomous-start`
- `buildAgentCommand` and `buildTmuxSessionName` from `lib/worktree.js` already support `'review'` role

## Out of Scope

- Fleet mode review step (Fleet already has eval → close; a review phase would require different orchestration)
- Auto-applying review fixes (review agent produces suggestions only; close still merges as-is)
- `feature-autonomous-start status` deep review session details (basic running/stopped is sufficient)

## Open Questions

- Should `--stop-after=close` wait for the review session to exit before closing, or check for a specific signal from the review agent? (Proposed: wait for tmux session exit, same pattern as Fleet eval phase)
- If the review agent raises blockers in the log, should AutoConductor abort the close? (Proposed: no — out of scope for v1; user can set `--stop-after=review` to inspect manually)

## Related

- Research:
- Feature: `feature-autonomous-start` (same handler, extending solo branch)
- `docs/specs/features/06-paused/feature-autonomous-swarm-execution-review.md` (paused, broader scope)
