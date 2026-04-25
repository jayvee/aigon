---
complexity: medium
set: review-cycle-redesign
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-24T23:50:04.502Z", actor: "cli/feature-prioritise" }
---

# Feature: review-cycle-redesign-4-dashboard

## Summary

Collapse the three bespoke review-rendering sites in the dashboard frontend (`utils.js:94-115`, `pipeline.js:666-812`, `index.html:108-114`) into a single server-driven `STATE_RENDER_META` map keyed by `currentSpecState`, and remove the now-redundant `buildSpecReviewBadgeHtml` / `buildSpecCheckBadgeHtml` helpers along with all `item.specReview.*` reads. The dashboard should render review badges, cycle history, and reviewer assignments purely from engine snapshot data — zero frontend eligibility logic, zero per-sub-state branching.

## User Stories

- [ ] As a maintainer, I want one place to change a review badge label (server-side `STATE_RENDER_META`) instead of three frontend sites.
- [ ] As an operator, I want the cycle history visible per feature: "Reviewed 2× by cx, gg" with timestamps.
- [ ] As a future contributor, I want adding a new review state to be a one-line `STATE_RENDER_META` entry, not a frontend audit.

## Acceptance Criteria

- [ ] `STATE_RENDER_META` map defined server-side (`lib/state-render-meta.js` or in `lib/workflow-snapshot-adapter.js`) with one entry per `currentSpecState`: `{ icon, label, cls, badge? }`.
- [ ] Dashboard API responses include `stateRenderMeta` per feature row; frontend renders badges from this metadata.
- [ ] Removed: `templates/dashboard/js/utils.js buildSpecReviewBadgeHtml`, `buildSpecCheckBadgeHtml`. Their callers consume `stateRenderMeta` instead.
- [ ] Removed: hardcoded `status-reviewing` / `status-review-done` Alpine `:class` bindings in `templates/dashboard/index.html:108-114`. Replaced with class derived from `stateRenderMeta.cls`.
- [ ] Removed: `templates/dashboard/js/pipeline.js:666-812` reviewer-section assembly. Replaced with cycle-history block rendered from `reviewCycles[]` (introduced in feature 3).
- [ ] Removed from server: `applySpecReviewFromSnapshots()` reads of `snapshot.specReview` (kept thin compatibility shim only if required for the migration window from feature 1).
- [ ] `buildAgentStatusHtml` in `pipeline.js` consults `STATE_RENDER_META` as baseline; compound conditions (tmux running, session ended) still override but no per-state string comparisons.
- [ ] Playwright screenshot taken before and after; review badges render identically (or with intentional improvements documented in PR description).
- [ ] Frontend has zero references to `item.specReview.*` after this feature.

## Validation

```bash
npm test
MOCK_DELAY=fast npm run test:ui
bash scripts/check-test-budget.sh
```

Specific test files (new or updated):
- `tests/integration/dashboard-state-render-meta.test.js` (new) — every `currentSpecState` has a `STATE_RENDER_META` entry; API response carries metadata.
- `tests/ui/review-badges.test.js` (new) — Playwright: spec-review, code-review, code-revision badges render correct icon/label/class.

Manual verification:
- Playwright screenshot of dashboard with feature in each review state (compare against pre-change baseline).

## Pre-authorised

- May invoke `Skill(frontend-design)` before any visual change (mandatory per AGENTS.md §Frontend & Visual Design Rules — pre-auth records that the agent did so without stopping to confirm).
- May skip backend-only test runs after the first commit (this feature is frontend-heavy; running `MOCK_DELAY=fast npm run test:ui` is sufficient for the dashboard-only commits).

## Technical Approach

**Files touched:**
- `lib/state-render-meta.js` (new) OR `lib/workflow-snapshot-adapter.js` — `STATE_RENDER_META` table; one entry per state.
- `lib/dashboard-status-collector.js` — attach `stateRenderMeta` to each feature row's payload.
- `lib/dashboard-routes.js` / `lib/dashboard-server.js` — ensure metadata reaches API response.
- `templates/dashboard/js/utils.js` — delete `buildSpecReviewBadgeHtml`, `buildSpecCheckBadgeHtml`. Add small helper that reads `stateRenderMeta`.
- `templates/dashboard/js/pipeline.js` — refactor `buildAgentStatusHtml`; remove reviewer-section bespoke assembly; add cycle-history block fed by `reviewCycles[]`.
- `templates/dashboard/index.html` — replace hardcoded `status-reviewing` / `status-review-done` Alpine bindings.
- After this feature: `lib/spec-review-state.js` `buildSpecReviewSummary()` either deleted or reduced to a pure helper used only inside the projector (not by any read path).

**Frontend rules (per AGENTS.md):**
- `Skill(frontend-design)` MUST be invoked before any visual change.
- Playwright screenshot MUST be taken after `templates/dashboard/index.html` edits.
- No new action buttons or eligibility logic in dashboard frontend (rule #8) — `validActions` from the registry is the only source.

## Dependencies

- depends_on: review-cycle-redesign-3-loop-and-sidecar

## Out of Scope

- New review-related visual designs (different colors, layouts) — this feature collapses logic, not aesthetics. If aesthetic improvements emerge during implementation, file a separate feature.
- Mobile responsiveness changes — out of scope unless directly affected by the badge collapse.
- Engine state additions (all states already exist after features 1–3).

## Open Questions

- Should `STATE_RENDER_META` live in a new `lib/state-render-meta.js` file or be co-located inside `lib/workflow-snapshot-adapter.js`? Recommend a new file — single responsibility, easy to grep, frontend-rendering metadata is a distinct concern from snapshot adaptation.
- Should the cycle-history block render for features with `reviewCycles.length === 0` (collapsed empty state) or hide entirely? Recommend hide entirely to reduce visual noise on never-reviewed features.

## Related

- Research: #37 State Machine & Review Cycle Redesign
- Set: review-cycle-redesign
- Prior features in set: review-cycle-redesign-1-spec-states, review-cycle-redesign-2-code-states, review-cycle-redesign-3-loop-and-sidecar
