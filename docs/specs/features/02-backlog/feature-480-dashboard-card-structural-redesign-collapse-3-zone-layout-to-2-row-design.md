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
- [ ] No `.kcard-headline` banner DOM renders inside pipeline cards — state info from `feature.cardHeadline` / server read models is mapped into the status row only.
- [ ] The separate primary agent-status row below the banner is gone — the active agent chip is inline in the status row. Dedicated fleet/review/GitHub subrows remain only where an explicit criterion below allows them.
- [ ] The standalone action-button row is gone for the primary CTA — CTA and overflow are inline in the status row right side and still come from `validActions`.
- [ ] `>_` button (not 👁) appears only when the relevant read model exposes a live tmux session (`agent.tmuxSession`/equivalent session field backed by `tmuxRunning` or `tmuxSessionExists`); it opens the existing dashboard terminal panel for that session.
- [ ] Multi-agent sequential pipeline: inline chips `CC ✓ · GG ●` where done = muted, active = liveness dot; detail line names the active action.
- [ ] Fleet cards: the summary uses the new title/status shell; per-agent rows render below it, each with liveness dot + `>_` only for a live session.
- [ ] Research fleet (RF1/RF2): same fleet row pattern, "Research ready" label, Evaluate CTA when all done.
- [ ] Autonomous stage track is visible whenever `feature.autonomousPlan` or `feature.autonomousSession` is present, shows `✓ Stage · Agent` per completed stage, and exposes the conductor `>_` only for a live conductor session.
- [ ] Dependency chips: `after #XX` — teal when dep closed, plain when pending. Start is disabled only via existing `validActions`/disabled-action rendering; do not add a second frontend eligibility rule.
- [ ] Feature set wrapper: teal-bordered container; expanded view shows full feature cards (not compact rows).
- [ ] Playwright screenshots verified for: implementing, implemented, code-reviewed, fleet-running, fleet-all-done, sequential-reviewing, autonomous-running, autonomous-all-done, blocked-dep, feature-set-expanded.
- [ ] `npm test` passes. No visual regressions on other dashboard surfaces.

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
1. Add all new CSS classes first (no rendering changes) — verify no regressions
2. Migrate `buildSoloAgentCard` (simplest, single-agent) — screenshot gate
3. Migrate `buildFeatureCard` for single-agent states — screenshot gate
4. Add sequential pipeline multi-agent chip rendering — screenshot gate
5. Migrate fleet card headline to new structure (per-agent rows already correct) — screenshot gate
6. Add autonomous stage track with per-stage agent attribution — screenshot gate
7. Add dependency chip rendering (`after #XX`, teal/plain states) — screenshot gate
8. Remove dead CSS/HTML from old 3-zone layout once all card types migrated

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

- Feature set autonomous start button (separate feature)
- ▾ expand detail drawer implementation (separate feature)
- Server-side changes to `lib/card-headline.js` (already done)
- Any changes to the kanban column/lane layout

## Open Questions

- None — wireframe is approved.

## Related

- Design reference: `docs/card-design-wireframe.html` (canonical, on `main`)
- Set: <!-- standalone -->
