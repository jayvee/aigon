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
- [ ] Set dashboard payloads include a `specReview` summary for each set with at least: `running` (bool), `agent`, `sessionName`, `anchorFeatureId`, `updatedAt`, and a human-readable `label`. Because there is **no persisted spec-review state file** (unlike the conductor's `readSetAutoState`), these fields are best-effort from the *live* session only: `running` and `sessionName` from the tmux/session lookup; `agent` and `anchorFeatureId` from the session sidecar; `updatedAt` from the sidecar file mtime (or session start time) — do **not** invent a `status` state machine or event log for spec reviews (see Out of Scope). When no live session exists, `specReview` is `null` or `{ running: false }`.
- [ ] The backend detects active set-wide spec review sessions launched by `feature-set-spec-review`. The **primary** discriminator is the structured session sidecar `metadata.setSpecReview.setSlug` that `launchSetSpecReviewTmuxSession` (`lib/feature-set-spec-review.js`) already writes via `createDetachedTmuxSession`. Fall back to the tmux **name shape** (repo prefix, anchor feature id, role `spec-review`, `desc: set-<slug>`) only when the sidecar is absent. Note that the existing `_readSidecarSessionName` in `lib/dashboard-status-helpers.js` does **not** currently read `metadata`, so the new helper must inspect it.
- [ ] Detection does not confuse ordinary single-feature spec reviews with set-wide spec reviews. A feature spec-review session for `#644` only counts for `close-integrity` when its sidecar `metadata.setSpecReview.setSlug === "close-integrity"` (or, on the name-shape fallback, `desc: set-close-integrity`). A plain `spec-review` session with no `setSpecReview` metadata and no `set-<slug>` desc must never match.
- [ ] If more than one live set spec-review session exists for the same set, the helper picks one deterministically (mirror the existing `sort((a, b) => b.length - a.length || a.localeCompare(b))` tie-break used by `safeSetAutoSessionExists`), rather than returning an arbitrary match.
- [ ] Set cards render distinct inline state for spec review and autonomous conductor. Suggested copy: `Spec review: running`, `Conductor: inactive`, `Conductor: running`, `Conductor: paused`, etc. Avoid relying only on color or the existing `0/4` progress bar.
- [ ] When `specReview.sessionName` is present, the set card renders a peek/open control for that review session using the existing dashboard session peek/open pattern. The autonomous conductor peek remains separate and keeps its current behavior.
- [ ] When no review or conductor is active, the card explicitly communicates inactivity in a compact way. It should not look like a missing/broken control.
- [ ] The `Review set specs` action transitions optimistically or refreshes promptly enough that the new review status appears within the normal dashboard poll cycle after launch.
- [ ] The `specReview` field is included in `computeStatusFingerprint` (`lib/dashboard-status-version.js`) so its changes bump `statusVersion` and push through the ETag/SSE pipeline (CLAUDE.md hot-rule 5b). The fingerprint currently carries **no set-card data at all**, so simply attaching `specReview` to the DTO will not repaint cards on its own — at minimum fold `running`, `agent`, and `sessionName` per set into the fingerprint.
- [ ] The UI remains dense and scannable in the existing dashboard style. No large explanatory panel, modal-only status, or marketing copy; this is operational state.
- [ ] Documentation updates explain the distinction between set spec review and set autonomous conductor in `site/content/guides/dashboard.mdx` and, if needed, `site/content/guides/feature-sets-autonomous.mdx`.
- [ ] Tests cover: backend set spec-review detection via sidecar `metadata.setSpecReview.setSlug`; the name-shape fallback; ordinary feature spec-review **non-matching** (no `setSpecReview` metadata → no match); the fingerprint bump (`specReview` change alters `computeStatusFingerprint` output); and frontend rendering of the spec-review state/peek affordance. Use focused tests near existing set-card/dashboard tests.

## Validation
```bash
npm run test:iterate
```
Because this touches `templates/dashboard/js/`, the iterate gate auto-runs the `@smoke` Playwright subset. Also verify the live behaviour once by hand:
```bash
# with a set that has reviewable members, launch a set-wide spec review, then:
aigon feature-set-spec-review <slug>
curl -s localhost:<port>/api/status | jq '.sets[] | select(.slug=="<slug>") | .specReview'
# expect: { running: true, sessionName: "<repo>-f<anchor>-spec-review-<agent>-set-<slug>", agent: ..., anchorFeatureId: ... }
```
An ordinary single-feature spec review of a member must leave `specReview` null/`{running:false}` for the set.

## Technical Approach
Start at the read side. `lib/dashboard-collect/set-cards.js` already builds the set card payload from `safeSetAutoSessionExists`, set membership, and valid actions. Add a parallel read helper for set spec-review visibility rather than overloading `autonomous`.

The helper should prefer structured session sidecars if available, because `lib/dashboard-status-helpers.js` already has `_readSidecarSessionName` patterns and `.aigon/sessions/*.json` carries entity metadata in newer flows. Fall back to tmux session names only where the existing launcher guarantees enough structure: repo prefix, anchor feature id, `spec-review`, and `set-<slug>`.

Keep the data model explicit:

- `autonomous` remains the conductor state for `set-autonomous-*`.
- `specReview` represents the set-wide spec review launched by `feature-set-spec-review`.
- The set card UI renders both. They should not share one status pill because that repeats the current ambiguity.

Likely touch points:

- `lib/feature-set-spec-review.js` — **verify only** in most cases: `launchSetSpecReviewTmuxSession` already writes `metadata.setSpecReview.setSlug` (plus `role: 'spec-review'`, anchor `entityId`) into the session record via `createDetachedTmuxSession`. Only enrich if a field the helper needs (e.g. a stable `updatedAt`) is genuinely absent.
- `lib/dashboard-status-helpers.js` for a `safeSetSpecReviewSessionExists(setSlug, repoPath)` helper, following the `safeSetAutoSessionExists` shape but reading the sidecar `metadata.setSpecReview.setSlug` as the primary match key.
- `lib/dashboard-collect/set-cards.js` to attach `specReview` to the set card DTO (note the existing `summarizeReviewSessions` normalizer here as a shape reference for session summaries).
- `lib/dashboard-status-version.js` to fold `specReview` into `computeStatusFingerprint` (see Acceptance Criteria — required for repaint).
- `templates/dashboard/js/pipeline.js` and/or `templates/dashboard/js/set-cards.js` to render compact badges and peek controls. Any new badge CSS must live in a sheet under `templates/dashboard/styles/` listed in `styles/manifest.json` — no inline `<style>` or CDN (dash-arch F620–F628).
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
