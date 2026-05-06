---
complexity: high
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-06T23:14:51.305Z", actor: "cli/feature-prioritise" }
---

# Feature: Dashboard card structural redesign — collapse 3-zone layout to 2-row design

## Summary

Every pipeline card currently renders three separate DOM zones — a headline banner block,
an agent-status row, and a standalone action-button row — that repeat the same two facts
(state and agent). This feature collapses the base card shell into a 2-row design: a title
row (ID + name + ▾ expand toggle) and a single status row (icon + state label + agent chip
with liveness dot + duration + `>_` terminal button + CTA + `···`), with an optional italic
detail line only when it adds genuinely new information. Fleet rows, autonomous stage tracks,
and expanded set contents are allowed only as the explicit add-ons listed below. The design
reference is `docs/card-design-wireframe.html` — read it in full before touching any card code.

## User Stories

- [ ] As a user scanning the board, I can see the state, agent, and primary CTA for any card in one glance without reading three separate zones.
- [ ] As a user with a sequential pipeline (CC implements → GG reviews), I can see both agents' states as inline chips (done agents muted, active agent with liveness dot) without separate rows.
- [ ] As a user watching a fleet of researchers, I can see each agent's individual progress and open their tmux session from their row via `>_`.
- [ ] As a user with blocked backlog features, I see `after #XX` dependency chips that are teal when the dep is closed and plain when pending; Start remains disabled through the existing action eligibility path until all deps are resolved.
- [ ] As a user in autonomous mode, I can always see the stage track with per-stage agent attribution and open the conductor's tmux session.

## Acceptance Criteria

- [ ] Each non-fleet, non-autonomous card shell renders exactly 2–3 rows maximum: title row, status row, optional detail line. Fleet rows, autonomous stage tracks, and expanded set member cards are the only permitted extra rows.
- [ ] The new status row consumes the existing `feature.cardHeadline` server payload (`{tone, verb, subject, owner, age, detail, glyph}`) — no new server read-model fields are introduced.
- [ ] No `.kcard-headline` (or any of its sub-classes: `-top`, `-glyph`, `-verb`, `-meta`, `-detail`, and the `tone-*` variants) renders in the DOM. All `.kcard-headline*` CSS rules in `templates/dashboard/styles.css` are deleted in the same commit that removes the last consumer.
- [ ] The separate primary agent-status row below the banner is gone — the active agent chip is inline in the status row. Dedicated fleet/review/GitHub subrows remain only where an explicit criterion below allows them.
- [ ] The standalone `.kcard-actions` row is gone for the primary CTA — CTA and overflow are inline in the status row right side and still come from `validActions` via `renderActionButtons`. The `.kcard-actions` CSS rule is deleted in the same commit that removes the last consumer.
- [ ] The existing SVG peek button (`.kcard-peek-btn`) is replaced everywhere with a `>_` text glyph button; the glyph is monospace text, not an SVG or emoji.
- [ ] `>_` button appears only when the relevant agent's `tmuxRunning === true` (and `tmuxSession` is set); clicking it calls `openTerminalPanel(...)` with the same arguments the current peek button uses.
- [ ] Multi-agent sequential pipeline: inline chips `CC ✓ · GG ●` where done = muted, active = liveness dot; detail line names the active action.
- [ ] Fleet cards: the summary uses the new title/status shell; per-agent rows render below it, each with liveness dot + `>_` only for a live session.
- [ ] Research fleet (RF1/RF2): same fleet row pattern, "Research ready" label, Evaluate CTA when all done.
- [ ] Autonomous stage track is visible whenever `feature.autonomousPlan` or `feature.autonomousSession` is present, shows `✓ Stage · Agent` per completed stage, and exposes the conductor `>_` only for a live conductor session.
- [ ] Dependency chips: `after #XX` — teal when dep closed, plain when pending. Source of truth is `feature.blockedBy` (already populated by the server). Start enable/disable is **only** controlled by `validActions` / disabled-action rendering; the chips are display-only.
- [ ] **MISSING_SNAPSHOT inbox/backlog rows** (F294/F296 — synthetic state from `buildMissingSnapshotState`) render correctly in the new shell with their server-supplied actions (Prioritise / Start). No special-case branch in the new card builder.
- [ ] **Feedback cards** (`pipelineType === 'feedback'`) render in the new shell using the same status-row mapping; the `cardHeadline` server payload already covers feedback.
- [ ] Feature set wrapper: teal-bordered container; expanded view shows full feature cards (not compact rows). Existing `set-autonomous-{start,stop,resume,reset}` `validActions` continue to render via `renderActionButtons`.
- [ ] Playwright screenshots verified for: implementing, implemented, code-reviewed, fleet-running, fleet-all-done, sequential-reviewing, autonomous-running, autonomous-all-done, blocked-dep, feature-set-expanded, missing-snapshot-inbox, feedback-card.
- [ ] `npm test` passes. No visual regressions on other dashboard surfaces (spec drawer, monitor view, detail tabs).

## Validation

```bash
npm run test:iterate
npm run test:ui
npm test
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration only when an iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright screenshots are still required before the feature is submitted.
- May update CSS in `templates/dashboard/styles.css` alongside `pipeline.js` changes without a separate commit.

## Technical Approach

**Reference**: `docs/card-design-wireframe.html` — open it at `http://localhost:7654/card-design-wireframe.html`
(serve: `python3 -m http.server 7654 --directory docs`). Do not deviate from it without
discussing with the user first.

**Primary files:**
- `templates/dashboard/js/pipeline.js` — `buildKanbanCard`, `buildAgentSectionHtml`, reviewer/eval/fleet branches, set wrapper rendering
- `templates/dashboard/js/actions.js` — `renderActionButtons` integration so primary CTA/overflow remain `validActions`-driven
- `templates/dashboard/js/utils.js` — replace `buildCardHeadlineHtml` usage with status-row data mapping; avoid keeping `.kcard-headline` as a hidden second source of truth
- `templates/dashboard/styles.css` — CSS additions for `.machip`, `.dep`, `.dep-id`, `.term`, `.set-wrap`, `.set-body`, `.cstages` with agent attribution
- `lib/card-headline.js` — vocabulary/source data only; do not change server headline derivation unless a missing read-model field blocks the UI

**Migration strategy (safe, incremental):**

The single entry point is `buildKanbanCard(feature, repoPath, pipelineType, repoMeta)` in `pipeline.js:848`.
It currently calls `buildCardHeadlineHtml(feature)` (the banner), then iterates agents calling
`buildAgentSectionHtml(...)`, then renders `renderActionButtons(...)` as a footer row. The
migration replaces these in place rather than introducing new card builders.

1. **CSS first** — add `.kcard-shell`, `.kcard-status-row`, `.machip`, `.dep`, `.dep-id`, `.term`, `.cstages`, `.set-wrap`, `.set-body` to `styles.css`. No rendering changes. Restart server, screenshot baseline.
2. **Status row mapping** — in `buildKanbanCard`, build a new `buildStatusRowHtml(feature)` helper that consumes `feature.cardHeadline` + the primary agent + `validActions` and emits the new 2-row shell. Render it BEHIND a feature flag (`?cards=v2` query param) so old and new can be A/B'd. Screenshot gate covering all single-agent states.
3. **Sequential pipeline chips** — extend `buildStatusRowHtml` to detect 2-agent done+active scenarios and render `.machip` chips inline. Screenshot gate.
4. **Fleet rows** — rewrite the agent loop in `buildKanbanCard` so the headline uses the new shell and per-agent rows use a slimmer `buildAgentRowHtml(...)` (replaces `buildAgentSectionHtml` for fleet). Screenshot gate. Research fleet falls out of this naturally.
5. **Autonomous stage track** — render the stage track from `feature.autonomousPlan.stages` with per-stage agent attribution. Conductor `>_` from `feature.autonomousSession`. Screenshot gate.
6. **Dependency chips** — replace the existing `blockedByHtml` block (`pipeline.js:881`) with the new `.dep-id` chip rendering. Screenshot gate.
7. **Feature set wrapper** — wrap set member cards in `.set-wrap` with the teal header + progress bar. Screenshot gate.
8. **Flip default and clean up** — remove the `?cards=v2` flag, delete `buildCardHeadlineHtml` from `utils.js`, delete `.kcard-headline*` and `.kcard-actions` CSS rules, delete `.kcard-peek-btn` CSS, remove the SVG peek button, run `npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh`.

**Key invariant**: the `validActions` server payload drives all CTA buttons — never
invent button logic client-side. Dependency chips may use `feature.blockedBy` for display,
but Start enablement/disablement must remain tied to the server-owned action payload. The
`>_` button only renders when the relevant session field resolves to a live tmux session
(use existing `tmuxSessionExists` / `tmuxRunning` patterns).

**Implementation ownership notes:**
- Keep the dashboard read-only: do not parse specs, logs, or workflow snapshots from frontend code.
- Preserve the existing `openTerminalPanel(...)` wiring for session buttons; this feature changes the glyph and placement, not the terminal transport.
- Replace old row classes only after every branch that used them has an equivalent in the new shell; avoid leaving hidden `.kcard-headline` markup in the DOM.

## Dependencies

- None. `lib/card-headline.js` vocabulary changes already merged to main.

## Out of Scope

- Feature set autonomous start button rewiring (existing `set-autonomous-*` `validActions` continue to render unchanged)
- ▾ expand detail drawer implementation — the toggle is rendered but its drawer is a separate feature
- Server-side changes to `lib/card-headline.js` or `lib/dashboard-status-collector.js` (vocabulary already merged; new fields not needed)
- Any changes to the kanban column/lane layout, the spec drawer, the monitor view, or the detail tabs panel
- Replacement of `openTerminalPanel(...)` transport — only the launching glyph and placement change

## Open Questions

- **▾ toggle behaviour during this feature**: render as a static affordance only (no drawer wired), or hide it entirely until the drawer feature lands? Default: render static, no-op click — establishes the visual slot for the follow-on feature.
- **MISSING_SNAPSHOT cards have no `cardHeadline.owner` (no agent yet)** — do we render the agent chip slot empty or omit the separator? Default: omit chip + adjacent `·` separator when `owner` is null.
- **Fleet research evaluator session** — when `evalStatus === 'pick winner'` is set but no eval session is live yet, where does the headline `>_` point? Default: hide the headline `>_` until an evaluator session exists.

## Related

- Design reference: `docs/card-design-wireframe.html` (canonical, on `main`)
- Set: <!-- standalone -->
