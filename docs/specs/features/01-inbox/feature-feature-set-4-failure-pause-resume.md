# Feature: feature-set-4-failure-pause-resume

## Summary
Define and implement the user-facing pause/resume/failure contract for a running set. When a member feature fails review or errors out, the SetConductor pauses the whole set (it does not skip ahead, because downstream members may depend on the failed feature's code), writes `paused-on-failure` into set-auto state, sends a desktop notification via the existing `lib/supervisor.js` channel, and surfaces the situation on the dashboard. A `set-autonomous-resume <slug>` command picks up from the saved cursor once the user has fixed the failing feature. This is the "what happens when things go wrong" layer that makes set autonomy actually trustworthy to walk away from.

## User Stories
- [ ] As a user whose set-run hit a review failure on feature 3 of 5, I get a desktop notification naming the failing feature and a dashboard badge on the set row.
- [ ] As a user, I can inspect the failing feature, fix it, close it, and then run `aigon set-autonomous-resume <slug>` to continue the set from feature 4 without re-spawning feature 3.
- [ ] As a user, I can see at a glance (in the dashboard and in `aigon set show <slug>`) which feature caused the pause and when.
- [ ] As a user who decides not to resume, I can `set-autonomous-reset <slug>` to clear the set-auto state without affecting per-feature state.

## Acceptance Criteria
- [ ] When any member's auto-state file transitions to `status: failed`, the SetConductor writes `status: paused-on-failure`, `failedFeature: <id>`, `pausedAt: <iso>` into the set-auto state file and exits its polling loop (but does NOT kill its tmux session — the session remains for dashboard observability until the user explicitly resumes or resets).
- [ ] A desktop notification is sent using the existing `lib/supervisor.js` notification path: "Set `<slug>` paused at feature #N — review failed. Run `aigon set-autonomous-resume <slug>` to continue after fix."
- [ ] `aigon set-autonomous-resume <slug>` is idempotent: if the set-auto state is `paused-on-failure`, it re-enters the loop starting at the failed feature (not skipping it — the user may have chosen to close it or replace it); if the failed feature is now `done` in workflow-core, the conductor advances to the next member.
- [ ] The dashboard set row gets an attention state (visual badge + tooltip) when `status === 'paused-on-failure'`. Screenshot attached to the PR per CLAUDE.md Rule 3.
- [ ] `aigon set show <slug>` output clearly marks the failing member and the pause state.
- [ ] Tests cover: state transitions (running → paused-on-failure → resumed → running), resume-when-failed-feature-now-done path, notification content, and the idempotent resume command.

## Validation
```bash
node -c aigon-cli.js
npm test
```

## Technical Approach
- **Failure signal source**: per-feature `feature-<id>-auto.json` transitioning to `status: failed`. No new signal type — reuse what AutoConductor already emits.
- **Dashboard**: extend `lib/dashboard-status-collector.js` to include set-level `status` and `failedFeature` in the sets roll-up payload added by feature-set-1. No new API endpoint. Frontend change in `templates/dashboard/index.html` for the attention-state badge.
- **Notification channel**: `lib/supervisor.js` already sends desktop notifications for agent liveness — reuse that helper. Do not add a new notification module.
- **Not crossing lines**:
  - Does not change when `feature-close` itself succeeds or fails (no shared code path with `lib/remote-gate-github.js`).
  - Does not auto-skip past the failed feature — explicit user action required. This preserves the dependency-correctness guarantee.
  - Does not kill per-feature AutoConductors — the set-level pause only halts *the SetConductor's sequencing*. Per-feature cleanup stays under `feature-reset` / `sessions-close`.

## Dependencies
- depends_on: feature-set-3-autonomous-conductor

## Out of Scope
- Automatic skip-on-failure for members whose downstream closure does not depend on the failed one (cu raised this as "best effort partial set" — agreed not MVP)
- Retry-from-scratch of the failed feature from the SetConductor (use `feature-reset` + `set-autonomous-resume` manually)
- Email / Slack notifications (desktop only — reuses existing channel)
- Set-level event log / events.jsonl (the durable-state JSON is enough; full event sourcing would be Option C from the research, deferred)

## Open Questions
- Should the pause also surface a write to `.aigon/state/` for "set paused" badge consumers that don't read the set-auto state directly, or is set-auto-state the sole source?
- When the failing feature is later manually moved back to backlog, should the conductor's resume treat it as "needs re-run" or "skip and advance"? Leaning "needs re-run" (safe default).

## Related
- Research: #34 feature-set
