---
complexity: high
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-08T13:02:10.319Z", actor: "cli/feature-prioritise" }
---

# Feature: set-review-session-visibility

## Summary
The set card currently makes feature-set progress visible, but it does not clearly distinguish a set-wide spec review from the autonomous set conductor. When `Review set specs` launches, the live work appears as a feature spec-review tmux session such as `aigon-f644-spec-review-cx-set-close-integrity`, while the set card only exposes the autonomous conductor affordance for sessions named like `<repo>-s<set>-auto`. The result is a confusing operator experience: the set may be actively under review, but the set card still looks idle and there is no obvious "peek" control. Add explicit set-card visibility for set spec-review sessions, separate from conductor state.

## User Stories
- [ ] As an operator, after I click `Review set specs`, the set card tells me that a set spec review is running, who is reviewing it, and when it last updated.
- [ ] As an operator, I can peek at the active set spec-review session from the set card without guessing the tmux session name.
- [ ] As an operator, I can tell the difference between "spec review is running", "autonomous conductor is running", and "nothing is active".
- [ ] As a maintainer, the dashboard derives this from the same backend session/state model used elsewhere, not from frontend-only naming guesses.

## Acceptance Criteria
- [ ] Set dashboard payloads include a `specReview` summary for each set with at least: `running`, `status`, `agent`, `sessionName`, `anchorFeatureId`, `updatedAt`, and `lastEvent` or equivalent human-readable label.
- [ ] The backend detects active set-wide spec review sessions launched by `feature-set-spec-review`. It must cover the current naming shape produced by `launchSetSpecReviewTmuxSession` in `lib/feature-set-spec-review.js`: feature anchor id, role `spec-review`, and `desc: set-<slug>`.
- [ ] Detection does not confuse ordinary single-feature spec reviews with set-wide spec reviews. A feature spec-review session for `#644` only counts for `close-integrity` when its session metadata/name identifies `set-close-integrity`.
- [ ] Set cards render distinct inline state for spec review and autonomous conductor. Suggested copy: `Spec review: running`, `Conductor: inactive`, `Conductor: running`, `Conductor: paused`, etc. Avoid relying only on color or the existing `0/4` progress bar.
- [ ] When `specReview.sessionName` is present, the set card renders a peek/open control for that review session using the existing dashboard session peek/open pattern. The autonomous conductor peek remains separate and keeps its current behavior.
- [ ] When no review or conductor is active, the card explicitly communicates inactivity in a compact way. It should not look like a missing/broken control.
- [ ] The `Review set specs` action transitions optimistically or refreshes promptly enough that the new review status appears within the normal dashboard poll cycle after launch.
- [ ] The UI remains dense and scannable in the existing dashboard style. No large explanatory panel, modal-only status, or marketing copy; this is operational state.
- [ ] Documentation updates explain the distinction between set spec review and set autonomous conductor in `site/content/guides/dashboard.mdx` and, if needed, `site/content/guides/feature-sets-autonomous.mdx`.
- [ ] Tests cover backend set spec-review detection, ordinary feature spec-review non-matching, and frontend rendering of the spec-review state/peek affordance. Use focused tests near existing set-card/dashboard tests.

## Validation
```bash
npm run test:iterate
```

## Technical Approach
Start at the read side. `lib/dashboard-collect/set-cards.js` already builds the set card payload from `safeSetAutoSessionExists`, set membership, and valid actions. Add a parallel read helper for set spec-review visibility rather than overloading `autonomous`.

The helper should prefer structured session sidecars if available, because `lib/dashboard-status-helpers.js` already has `_readSidecarSessionName` patterns and `.aigon/sessions/*.json` carries entity metadata in newer flows. Fall back to tmux session names only where the existing launcher guarantees enough structure: repo prefix, anchor feature id, `spec-review`, and `set-<slug>`.

Keep the data model explicit:

- `autonomous` remains the conductor state for `set-autonomous-*`.
- `specReview` represents the set-wide spec review launched by `feature-set-spec-review`.
- The set card UI renders both. They should not share one status pill because that repeats the current ambiguity.

Likely touch points:

- `lib/feature-set-spec-review.js` for confirming or enriching session sidecar metadata when launching review sessions.
- `lib/dashboard-status-helpers.js` for a `safeSetSpecReviewSessionExists(setSlug, repoPath)` helper.
- `lib/dashboard-collect/set-cards.js` to attach `specReview` to the set card DTO.
- `templates/dashboard/js/pipeline.js` and/or `templates/dashboard/js/set-cards.js` to render compact badges and peek controls.
- `site/content/guides/dashboard.mdx` for operator-facing wording.

## Dependencies
- Existing feature-set spec review launcher and session naming in `lib/feature-set-spec-review.js`.
- Existing set card read model in `lib/dashboard-collect/set-cards.js`.
- Existing tmux/session peek affordances in the dashboard frontend.

## Out of Scope
- Changing how set-wide spec reviews are executed.
- Changing the autonomous set conductor lifecycle.
- Adding a new scheduler or queue for reviews.
- Reworking the entire set card layout beyond the compact status/peek additions.
- Surfacing transcript history after a review completes, unless it falls out naturally from existing session records.

## Open Questions
- Should completed set spec reviews remain visible on the set card for a short time, or should the card only show live sessions? Recommendation: show live sessions first, then consider completed history after transcript retention is clearer.
- Should the `Review set specs` action label be more explicit, such as `Review all specs`, now that the card will show a separate spec-review state? Recommendation: keep the label for now; fix visibility before renaming again.

## Related
- User-reported incident: `close-integrity` showed `Review set specs`, but no visible controller or progress indicator while a live session existed: `aigon-f644-spec-review-cx-set-close-integrity`.
- Existing set-card docs: `site/content/guides/dashboard.mdx`.
- Existing autonomous-set docs: `site/content/guides/feature-sets-autonomous.mdx`.
- Relevant code: `lib/feature-set-workflow-rules.js`, `lib/feature-set-spec-review.js`, `lib/dashboard-status-helpers.js`, `lib/dashboard-collect/set-cards.js`, `templates/dashboard/js/pipeline.js`.
