---
set: feature-set
---

# Feature: feature-set-3-autonomous-conductor

## Summary
Introduce a **SetConductor** — a detached tmux loop (`<repo>-s<slug>-auto`) that walks the members of a feature set in topological order and delegates each feature to the existing `feature-autonomous-start` AutoConductor. The conductor does not reimplement the single-feature loop; it sequences it. Default execution is sequential and waits for each member's `feature-close` to succeed (merged to `main`) before starting the next — the design lock-in cc and cu both identified as the single decision that collapses the otherwise nasty branch-base / rebasing design space into a straight line. This is what unlocks "kick off a whole feature set once, walk away, come back to merged code" — the primary motivation of research 34.

## User Stories
- [ ] As a user with a feature set of 3–5 related features, I can run `aigon set-autonomous-start <slug>` and have them executed end-to-end without intervention between features.
- [ ] As a user whose machine rebooted mid-run, the SetConductor resumes from the last-completed member when I re-run the command (idempotent resume, same pattern as AutoConductor).
- [ ] As a user, I can stop a running set with `aigon set-autonomous-stop <slug>` without corrupting per-feature auto-state.
- [ ] As a user on the dashboard, I can see that a set is running and which feature is currently in flight.

## Acceptance Criteria
- [ ] New CLI commands: `aigon set-autonomous-start <slug> [--mode=sequential] [--review-agent=<agent>] [--stop-after=close]`, `set-autonomous-stop <slug>`, `set-autonomous-resume <slug>`, `set-autonomous-reset <slug>`.
- [ ] `set-autonomous-start` resolves members by scanning for `set: <slug>`, topologically sorts using `lib/entity.js` dep graph (error on cycle), and spawns a detached tmux session named `<repo>-s<slug>-auto`.
- [ ] The SetConductor loop: for each member in order — skip if already done; attach (not re-spawn) if an existing `feature-<id>-auto.json` is present and running; otherwise invoke `feature-autonomous-start <id> <agents>` and poll the per-feature auto-state file every 30s until its `status` transitions to `done` or `failed`.
- [ ] On member `done`: update set-auto state, continue to next.
- [ ] On member `failed`: stop the loop, write `status: paused-on-failure` with the failing feature id, keep the set-auto state file intact for `set-autonomous-resume` later.
- [ ] On all members `done`: write `status: done` to set-auto state and kill own tmux session (mirrors AutoConductor self-termination).
- [ ] Durable state file at `.aigon/state/set-<slug>-auto.json` with shape `{ setSlug, members[], order[], currentFeature, completed[], failed[], status, startedAt, mode, reviewAgent? }`. Exclusive file locking on writes.
- [ ] Pro-gated via `assertProCapability('Autonomous set orchestration', ...)` — consistent with `feature-autonomous-start`. Free tier receives a pointer to aigon-pro.
- [ ] Tests cover: topological resolution from spec fixtures, resume-after-kill behavior (mock tmux), handling of already-merged members, refusal on dep cycles, correct tmux session naming.

## Validation
```bash
node -c aigon-cli.js
npm test
```

## Technical Approach
- **Location**: `lib/commands/feature.js` or a new `lib/set-conductor.js` for the loop body, with command wiring in a new `lib/commands/set.js` (same file feature-set-1 added for `set list/show`).
- **Safe-to-start contract**: wait for `feature-close` success (merged to main). This is the cleanest default — B then branches off a fresh `origin/main` that already contains A's code, and the existing `lib/remote-gate-github.js` PR-aware close logic works without special-casing.
- **Mode**: sequential only in this feature. Parallel ready-queue execution is a deferred follow-on (`feature-set-parallel-execution`).
- **Solo vs Fleet**: pass-through per member — the per-feature `feature-autonomous-start` call is already agent-list-aware, so SetConductor doesn't encode mode itself.
- **Existing patterns reused**:
  - `lib/entity.js` dep graph + DFS cycle detection — as-is
  - `feature-autonomous-start __run-loop` — invoked, not replicated
  - `lib/remote-gate-github.js` — provides the "merged to main" signal
  - `persistFeatureAutoState()` pattern — mirrored for set-auto state
  - `lib/auto-session-state.js` conventions — mirrored for durable set state
- **Pro gate**: `lib/pro.js` / `lib/pro-bridge.js` — do not add new `getPro()` call sites.

## Dependencies
- depends_on: feature-set-1-membership-and-board

## Out of Scope
- Pause-on-failure UX, dashboard badge, desktop notification (feature-set-4)
- Set-level dashboard card with action buttons (feature-set-5)
- Parallel execution / ready-queue (deferred)
- Set-level evaluation stage (explicitly rejected by all three agents' findings)
- Cross-repo set orchestration (explicitly out of scope)
- Telemetry rollup by set (deferred)

## Open Questions
- Should the SetConductor default its per-feature `--review-agent` from the set's first-member spec, or require it on the `set-autonomous-start` flag? Leaning require-on-flag for explicitness.
- When `set-autonomous-reset <slug>` is invoked while members are mid-run, do we also call `feature-reset` for each, or leave per-feature cleanup to the user? Leaning leave-to-user (matches the "feature-reset is the primitive" discipline from CLAUDE.md).

## Related
- Research: #34 feature-set
