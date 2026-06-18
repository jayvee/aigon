---
complexity: high
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-18T12:06:14.635Z", actor: "cli/feature-prioritise" }
---

# Feature: Schedule autonomous feature sets

## Summary
`aigon schedule add` can currently schedule a single `feature_autonomous` run, but it has no equivalent target for running a feature set through the existing SetConductor. Add a scheduled kickoff target for autonomous feature sets so a user can schedule `aigon set-autonomous-start <slug> ...` for a future time with the same repo scoping, listing, cancellation, and dashboard visibility semantics as single-feature autonomous jobs.

## User Stories
- [ ] As a user with a feature set already visible on the dashboard, I can schedule the set to start autonomously later, using the same agent-picker inputs I would pass to `set-autonomous-start` now.
- [ ] As a user who schedules overnight work, I can list and cancel a scheduled set-autonomous kickoff before it runs.
- [ ] As a user scanning the dashboard, I can tell that a set has a pending scheduled autonomous kickoff and see when it will run.

## Acceptance Criteria
- [ ] `aigon schedule add set_autonomous <set-slug> --run-at=<iso8601> <agents...> [--review-agent=<id>] [--models=<csv>] [--efforts=<csv>] [--stop-after=close] [--repo=<path>]` creates a scheduled job that invokes the existing set conductor path at runtime.
- [ ] The scheduled job executes the equivalent of `aigon set-autonomous-start <set-slug> <agents...> ...` in the target repo; it does not duplicate SetConductor sequencing logic inside the scheduler.
- [ ] The new schedule target validates the set slug using the same rules as `set-autonomous-start`, rejects missing/invalid slugs, and preserves the existing `--repo` behavior.
- [ ] The scheduler accepts the same supported set-autonomous launch options that `lib/set-conductor.js` currently accepts for start: agents, `--review-agent`, `--models`, `--efforts`, and `--stop-after=close`.
- [ ] Unsupported set modes or unsupported `--stop-after` values fail before the job is persisted, matching the immediate-start command's user-facing constraints.
- [ ] `aigon schedule list` shows set-autonomous jobs with enough detail to distinguish the set slug, repo, run time, selected agents, review agent, and pending/running/completed/cancelled state.
- [ ] `aigon schedule cancel <jobId>` works for set-autonomous jobs exactly as it does for existing scheduled feature-autonomous jobs.
- [ ] The dashboard schedule UI/API, if present in the current Pro implementation, can create, list, and cancel set-autonomous jobs without special-casing the set conductor in frontend code beyond target metadata and input shape.
- [ ] Set cards expose pending scheduled kickoff metadata in the dashboard read model so users can see that a set is scheduled before it starts.
- [ ] OSS behavior stays a thin Pro-delegating stub: without Pro installed, `aigon schedule ...` still prints the standard Pro notice and exits non-zero.
- [ ] CLI help and docs mention `schedule add set_autonomous ...` alongside `feature_autonomous`.

## Validation
```bash
node -c aigon-cli.js
npm test -- --runInBand
```

## Technical Approach
Keep the scheduler implementation in the Pro schedule boundary. In OSS, `lib/commands/schedule.js` remains only a delegating stub; do not add scheduler engine behavior back into this repo unless the product boundary changes.

In the Pro scheduler, add a new job target named `set_autonomous`. Its persisted payload should capture the set slug, repo path, agent ids, optional review agent, optional model/effort CSVs, and `stopAfter`. At execution time, dispatch through the existing public CLI behavior, effectively:

```bash
aigon set-autonomous-start <slug> <agents...> --review-agent=<id> --models=<csv> --efforts=<csv> --stop-after=close
```

Use the existing SetConductor as the source of truth for ordering, cycle handling, pause-on-failure, resume, reset, and per-feature autonomous launches. The scheduler owns only time-based kickoff, persistence, cancellation, and display of the pending job.

Audit the existing single-feature scheduled autonomous target and mirror its conventions for:

- job id generation and persistence
- run-at parsing and timezone handling
- repo resolution
- cancellation state
- failure reporting
- dashboard/API DTOs
- help text and docs

For dashboard visibility, attach pending schedule metadata to the set read model/card in the same style used for scheduled features, but do not make the frontend infer set action eligibility. `lib/feature-set-workflow-rules.js` remains the owner of set action availability; scheduled status is an orthogonal badge/detail, not a replacement for `validActions`.

## Dependencies
- Existing Pro schedule implementation for `feature_autonomous`.
- Existing SetConductor commands: `set-autonomous-start`, `set-autonomous-stop`, `set-autonomous-resume`, and `set-autonomous-reset`.
- Existing feature-set membership via `set:` frontmatter.

## Out of Scope
- A new OSS scheduler engine.
- New set execution modes beyond `--mode=sequential`.
- Recurring set schedules. This feature is for one scheduled kickoff; recurrence can be a later feature.
- Changing SetConductor ordering, failure, resume, or reset semantics.
- Auto-creating feature sets or modifying feature-set membership.

## Open Questions
- Should the CLI target name be `set_autonomous` to match `feature_autonomous`, or should Pro accept aliases such as `feature_set_autonomous` for discoverability? Default recommendation: canonical `set_autonomous`, optional aliases only if the existing scheduler target parser already supports aliases.
- Should dashboard set cards show the next scheduled kickoff only, or every pending job for the set? Default recommendation: show the next scheduled kickoff on the card and all jobs in the schedule list/detail view.

## Related
- Feature 316: Feature set autonomous conductor.
- Feature 319: Feature set failure pause/resume.
- Feature 236: Scheduler and recurring work moved to `@aigon/pro`.
- `lib/commands/schedule.js`: OSS Pro-delegating schedule stub.
- `lib/set-conductor.js`: existing set autonomous execution path.
