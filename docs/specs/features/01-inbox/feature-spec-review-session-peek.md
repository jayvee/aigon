---
complexity: high
# agent: cc    # optional — id of the agent that owns this spec. Used as the
#              #   default reviewer for spec-revise cycles when the operator
#              #   does not pick one explicitly. Precedence at revision time:
#              #     event payload nextReviewerId > frontmatter agent:
#              #     > snapshot.authorAgentId > getDefaultAgent().
# research: 44 # optional — id (or list of ids) of the research topic that
#              #   spawned this feature. Stamped automatically by `research-eval`
#              #   on features it creates. Surfaced in the dashboard research
#              #   detail panel under Agent Log → FEATURES.
# planning_context: ~/.claude/plans/your-plan.md  # optional — path(s) to plan file(s)
#              #   generated during an interactive planning session (e.g. EnterPlanMode).
#              #   Content is injected into the agent's context at feature-do time and
#              #   copied into the implementation log at feature-start for durability.
#              #   Set this whenever you ran plan mode before writing the spec.
# set: my-slug  # optional — ONLY when creating 2+ inbox peers to ship together.
#              #   Run `aigon set list` / `aigon set show <slug>` first. NEVER tag into
#              #   a completed set (all members done). Follow-up work: standalone + depends_on.
---

# Feature: spec-review-session-peek

<!-- Authoring AI: set `complexity:` using this rubric before writing the spec:
       low       — config tweaks, doc-only, single-file helpers, trivial bug fixes
       medium    — standard feature with moderate cross-cutting, one command handler, small refactor
       high      — multi-file changes, new public surfaces, judgment-heavy deletion work
       very-high — architectural shifts, contract-breaking changes, new invariants, cross-cutting work that spans multiple subsystems
     At start time, model and effort defaults come from each agent's complexity-defaults
     table (not from this spec). Do not put model IDs in the spec. -->

## Summary
When a feature or research item is in a spec-review or spec-revision cycle, the dashboard must expose the live tmux session with the same peek/open controls used for implementation, evaluation, and code-review sessions. Today the backend can create and discover `spec-review` tmux sessions, but the main card renderer only shows spec-review session blocks in the fallback layout for cards without active agent sections. The result is a card that can display "Spec Review / <agent> - Reviewing" while offering no way to peek at or open the tmux pane.

## User Stories
- [ ] As an operator, I can peek at a live spec-review session directly from the dashboard card while the review is running.
- [ ] As an operator, I can open the live spec-review/spec-revision session in my terminal from the same card section.
- [ ] As an operator, I see consistent session controls for spec review, spec revision, code review, implementation, and evaluation sessions.
- [ ] As an operator, submitted spec-review sessions that are still alive remain peekable for forensics or follow-up.
- [ ] As an operator, after a spec review is submitted, the dashboard clearly nudges me to run spec revision before starting implementation.

## Acceptance Criteria
- [ ] `feature.specReviewSessions`, `feature.specRevisionSessions`, and `feature.specCheckSessions` render on dashboard cards in every relevant layout branch, including cards that also have active agent sections.
- [ ] The existing reviewer-section UI renders a peek button whenever a spec-review/spec-revision DTO has a session name.
- [ ] The existing reviewer-section UI renders an "Open" action when the underlying spec-review/spec-revision tmux session is alive, even if the workflow state says the review has been submitted or is pending revision.
- [ ] `/api/peek/:id/:agent` can resolve live `spec-review`, `spec-revise`, and `spec-check` sessions for both feature and research entities, in addition to the existing implementation/eval/code-review fallbacks.
- [ ] The read model reports live tmux state for spec-review and spec-revision rows without changing workflow lifecycle semantics; a pending submitted review may remain `status: pending` while still exposing live session controls.
- [ ] When one or more spec reviews are pending and the server-provided `validActions` includes `feature-spec-revise` or `research-spec-revise`, the card renders a compact pending-review callout under the spec-review section.
- [ ] The pending-review callout includes a primary "Revise spec" action that uses the existing validAction handling path, including the existing agent picker behavior when a reviewer/checker must be selected.
- [ ] The pending-review callout includes secondary review access, either via the existing peek control when a session is alive or a "View review" affordance when a review commit/log path is available.
- [ ] While a spec review is pending, "Start" is not the visually primary next action on the card; it is demoted, hidden behind overflow, or otherwise lower priority than "Revise spec" without changing backend transition validity.
- [ ] Research spec-review cards receive the same peek/open behavior as feature spec-review cards.
- [ ] Existing implementation, evaluation, code-review, set-level spec-review, and autonomous peek controls continue to work.
- [ ] Tests or focused assertions cover the dashboard render helper/read-model behavior and the `/api/peek` session resolution path for `spec-review`.

## Validation
<!-- Optional: commands the iterate loop runs after each iteration (in addition to project-level validation).
     Use for feature-specific checks that don't fit in the project's general checks.
     All commands must exit 0 for the iteration to be considered successful.
     Leave the block below empty or remove it if there is nothing feature-specific to run. -->
```bash
npm test
node -c aigon-cli.js
```

## Pre-authorised
<!-- Optional: grant specific policy-gate skips for this feature only.
     Each line is a single bullet authorising one action. When an agent proceeds
     under a line, the commit footer must be `Pre-authorised-by: <slug>` where
     `<slug>` is the slugified line text (lowercase, non-alphanumerics → hyphens).
     Slugs are validated against this section at feature-close — invented footers block close. -->

## Technical Approach
Relevant current behavior:

- `lib/dashboard-actions/launch-spec-review.js` creates sessions using roles such as `spec-review` and `spec-revise`.
- `lib/workflow-read-model.js` already builds `specReviewSessions` and `specCheckSessions` from `snapshot.specReview`.
- `lib/dashboard-collect/feature-poll.js` and `lib/dashboard-collect/collect-research.js` already include those arrays in dashboard DTOs.
- `templates/dashboard/js/pipeline.js` only renders spec-review sections in the fallback card branch for cards without active agents. The active-agent branch renders agents, eval, and code-review sessions, then skips spec-review sessions entirely.
- `lib/dashboard-routes/sessions.js` has a generic `/api/peek/:id/:agent` fallback that checks implementation/eval/code-review session names but not spec-review roles.

Implementation plan:

1. Extract a small `buildSpecReviewSectionsHtml(feature)` helper in `templates/dashboard/js/pipeline.js` that renders:
   - `feature.specReviewSessions` as `buildReviewerSectionHtml('Spec Review', row, { mode: 'spec' })`
   - `feature.specRevisionSessions || feature.specCheckSessions` as `buildReviewerSectionHtml('Spec Revision', row, { mode: 'spec-revise' })`
2. Append that helper in all card branches that can render a non-done item, especially the active-agent branch near the existing code-review section.
3. Update `buildReviewerSectionHtml()` so the Open button keys off live session state rather than strictly `reviewer.running === true`. Keep the visible status text driven by workflow status so submitted/pending reviews still read correctly.
4. Update `readSpecReviewSessions()` and `readSpecCheckSessions()` in `lib/workflow-read-model.js` to include live tmux information, for example `sessionRunning: Boolean(session && tmuxSessionExists(session))`. Preserve `status`, `source`, and `running` meanings unless the current code already treats `running` as tmux liveness for that row.
5. Extend `/api/peek/:id/:agent` in `lib/dashboard-routes/sessions.js` to search `spec-review`, `spec-revise`, and `spec-check` roles for both `f` and `r`. Prefer using existing session-name parsing/helpers rather than hardcoding one fragile exact name.
6. Add a server-driven pending spec-review nudge to the card UI:
   - Render only when pending spec-review state exists and the appropriate `*-spec-revise` validAction is present.
   - Place the callout directly under the spec-review row so the sequence is visible: review submitted -> revise spec.
   - Suggested copy:
     - `1 spec review pending`
     - `Address the review before starting implementation.`
     - For multiple reviews, use `N spec reviews pending`.
   - Primary action: `Revise spec`, wired through the existing validAction button machinery.
   - Secondary action: `View review` when review material is available; otherwise keep the row-level peek button as the review access point.
   - Demote `Start` while the callout is active so the dashboard does not visually encourage implementation before review feedback is addressed. Do not remove backend start validity unless the state machine already disallows it.
7. Add focused tests around the changed helper/read-model/route behavior if the local test structure has existing dashboard tests. If no suitable harness exists, add the narrowest test that exercises the exported/readable logic without requiring a real dashboard browser.

Known reproduction from local diagnosis:

- Feature F649 had a live tmux session named `aigon-f649-spec-review-cx-nudge-confirm-robust-codex-wrap`.
- `.aigon/sessions/aigon-f649-spec-review-cx-nudge-confirm-robust-codex-wrap.json` recorded `role: "spec-review"`.
- The dashboard card displayed a spec-review row but did not expose a peek button in the primary card layout.

## Dependencies
<!-- Other features, external services, or prerequisites.
     For Aigon feature dependencies use: depends_on: feature-name-slug
     This enables ordering enforcement — dependent features can't start until deps are done. -->
- None.

## Out of Scope
- Redesigning dashboard card hierarchy or changing state labels.
- Changing workflow lifecycle transitions for spec review or spec revision.
- Changing how spec-review sessions are launched.
- Adding new terminal/pty infrastructure.

## Open Questions
- None known.

## Related
- Prior work: F341 spec review states; F554 agent session boundary; F632 dashboard/session read-model split.
<!-- Do NOT add `set:` here or in frontmatter to "join" a completed initiative.
     See .aigon/docs/feature-sets.md § Completed sets — do not rejoin. -->
