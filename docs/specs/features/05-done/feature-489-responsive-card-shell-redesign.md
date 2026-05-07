---
complexity: high
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-07T05:43:06.170Z", actor: "cli/feature-prioritise" }
---

# Feature: responsive-card-shell-redesign

## Summary

Redo the dashboard pipeline-card redesign that F480 attempted, this time with column-width
sizing and per-card responsiveness as first-class concerns. The 2-row card shell (title row +
status row) from `docs/card-design-wireframe.html` is still the goal — the rework is required
because F480 collapsed the 3-zone shell at the wireframe's intended **380px** card width but the
production kanban actually renders columns at a **220px** floor, which clipped the cs-l status
text invisibly, pushed cs-r buttons past the card edge, and left dead air on inbox/backlog cards.
This feature lands the column-width fix and the card-shell rewrite together so they're tested
against each other.

F480's merge (4b40e167) was reverted in commit 66c69e32; the F480 spec and log remain in
`05-done` as the historical record of the failed attempt.

## User Stories

- [ ] As a user on a 13" MacBook Pro at native scaling, I can read the active state, agent name, and duration on every in-progress card without horizontal clipping.
- [ ] As a user on a 4K coding monitor, the kanban uses my horizontal real estate sensibly — cards don't stretch into giant whitespace bricks, and extra space yields more visible columns or sane padding instead.
- [ ] As a user with a long action set on an in-progress card (`>_ · Open cc · ··· · Nudge…`), the actions wrap to a second row when the card is too narrow rather than punching past the card edge.
- [ ] As a user scanning Inbox/Backlog at any width, the card communicates "needs prioritisation" / "ready to start" without empty banks of dead space alongside the CTA.
- [ ] As a user resizing the dashboard window from 1024px to 2560px, the card layout adapts continuously — there is no width band where the card looks broken.

## Acceptance Criteria

### Column / kanban-grid sizing

- [ ] `.kanban` column floor raised from `220px` → **`300px`** in `templates/dashboard/styles.css:220`. Below 300px per column the kanban gets a horizontal scrollbar (already enabled via `overflow-x: auto`); columns never compress below 300px and clip card content again.
- [ ] Column **maximum** width capped at **`380px`** (the wireframe-designed width). Use `minmax(300px, 380px)` on `.kanban` grid template, or equivalent with `max-width` on `.kanban-col`.
- [ ] On viewports wider than `(--kanban-cols × 380px)`, the leftover space is centered as gutter padding around the kanban — not absorbed into stretched cards. (No card may render wider than 380px content area, regardless of viewport.)
- [ ] On viewports narrower than `(--kanban-cols × 300px)`, the kanban scrolls horizontally; existing `overflow-x: auto` behaviour is preserved.
- [ ] `--kanban-cols` CSS variable continues to work as the active-columns count source of truth.

### Card shell — 2 rows base, 3rd row only when needed

- [ ] Each non-fleet, non-autonomous card renders a **title row** (id + name + optional status badges like spec-drift/scheduled-glyph) and a **status row** (state label + agent chip + liveness dot + duration on the left; terminal `>_` + primary CTA + `···` overflow on the right). No persistent third "actions" row, no `▾` no-op toggles.
- [ ] When the action set on the right would overflow the card width (terminal + per-agent scoped actions + primary CTA + overflow), the right group **wraps to a new line below the status row** instead of being clipped or pushing past the card edge. The wrap is opt-in via `flex-wrap` / `@container` query, not unconditional.
- [ ] CSS container queries (`@container card (max-width: …px)`) on `.kcard` drive the wrap threshold so the card responds to its own rendered width, not the viewport.
- [ ] `cs-l` (status text) is **mandatory-visible** when a headline exists. If horizontal space runs out, scoped actions move to a wrap row first; the status text never gets clipped to invisible.
- [ ] `cs-r` (right group) **does not** use `flex-shrink: 0` — it shrinks before overflowing the card. F480's exact regression (`styles.css:306` had `flex-shrink: 0`) must not return.
- [ ] Inbox/backlog cards (no headline label by design — see `lib/card-headline.js:155,164`): the CTA + `···` are positioned so the card doesn't read as a near-empty rectangle. Acceptable approaches: center the cs-r group in the row, or fold the CTA into a subtle badge inside the title row. The design choice is the implementer's, but the result must look intentional at 300px column width.
- [ ] All `.kcard-headline*` (`-top`, `-glyph`, `-verb`, `-meta`, `-detail`, `tone-*`) DOM and CSS is removed in the same commit that removes the last consumer. `buildCardHeadlineHtml` in `templates/dashboard/js/utils.js` is deleted. `.kcard-actions` standalone row is removed.

### State coverage

- [ ] Inbox card (no agent, no headline) — looks intentional at 300px, 380px, 500px card widths.
- [ ] Backlog card (no agent) and Backlog blocked-by-deps (`feature.blockedBy`) — `after #XX` chips render below status row; teal when dep closed, plain when pending. `Start` enable/disable comes from `validActions` only.
- [ ] In-progress single-agent (Drive) — status row shows `● Implementing · CC · 14m` on left; right group fits within 300px without wrap. Wider cards just keep more padding.
- [ ] In-progress sequential (cc → gg) — inline `.machip` chips: muted-done + active-with-dot, no separate agent rows.
- [ ] Fleet (research RF1/RF2 or feature fleet) — summary uses new shell; per-agent rows render below with their own liveness dot + `>_`.
- [ ] Autonomous — stage track renders below status row, conductor `>_` exposed only when `autonomousSession.running === true`.
- [ ] In-eval / pick-winner — uses the same shell; eval CTA inline.
- [ ] Closed — terse: `✓ CLOSED · CC · 4m`, no actions.
- [ ] Failover/error — warn-tone left border, attention CTA inline.
- [ ] MISSING_SNAPSHOT inbox/backlog (`buildMissingSnapshotState` synthetic state — F294/F296) — renders correctly with synthetic Prioritise/Start actions; no special-case branch.
- [ ] Feedback (`pipelineType === 'feedback'`) — same shell, headline mapping already exists in `card-headline.js`.

### Responsiveness verification

- [ ] Playwright screenshots captured for the **product** of {3 column widths} × {state coverage above}: 220px (forced by narrow viewport with `--kanban-cols=6`), 300px (column floor), 380px (column cap). Stored under `tests/dashboard-snapshots/` or equivalent. The reviewer must see the 220px column shows horizontal scroll rather than clipping.
- [ ] Manual verification at three real viewport widths before submission: **1280×800** (13" MBP retina effective), **1920×1080** (typical external monitor), **2560×1440** (4K coding monitor at 1.5× scale). Implementation log records what each looked like with attached screenshots. F480's specific failure mode was that this manual cross-width check never happened — make it a blocking gate here.

### Tests

- [ ] `npm test` passes (lint + integration + workflow-core).
- [ ] `MOCK_DELAY=fast npm run test:ui` passes — no Playwright e2e regressions on `failure-modes`, `fleet-lifecycle`, `mark-complete`, `solo-lifecycle`, `workflow-e2e`. F480's review left **8 e2e failures unresolved** (see `feature-480-…-log.md` Code Review § Escalated Issues); this redo must not ship with any of them open.
- [ ] `bash scripts/check-test-budget.sh` passes; if new screenshot tests push the budget, raise CEILING in the same commit and note it under Pre-authorised.

### Behaviour invariants (do not break)

- [ ] All CTA buttons remain driven by server-supplied `feature.validActions` via `renderActionButtons(...)` — no client-side button logic.
- [ ] `>_` terminal button only renders when the relevant agent's `tmuxRunning === true` and `tmuxSession` is set; click handler stays `openTerminalPanel(...)`.
- [ ] Dashboard remains read-only: no spec/log/snapshot parsing in frontend code.
- [ ] No server-side changes to `lib/card-headline.js` or `lib/dashboard-status-collector.js` beyond what's required to add a missing read-model field that the new shell genuinely needs (justify in the log).

## Validation

```bash
npm run test:iterate
MOCK_DELAY=fast npm run test:ui
npm test
bash scripts/check-test-budget.sh
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.
- May raise `scripts/check-test-budget.sh` CEILING by up to +60 LOC if cross-width screenshot fixtures push it over.
- May add CSS container query (`@container card …`) declarations to `.kcard` and update its `container-type: inline-size` setup without a separate commit.

## Technical Approach

**Reference**: `docs/card-design-wireframe.html` — open at `http://localhost:7654/card-design-wireframe.html`
(serve: `python3 -m http.server 7654 --directory docs`). The wireframe still drives the
visual vocabulary for **`>=`380px** cards. For narrower widths the wireframe is silent —
this feature's job is to define what the card does between 300px and 380px without breaking
the wireframe's grammar.

**Primary files:**
- `templates/dashboard/styles.css` — `.kanban` grid template (line 220), new `.kcard` `container-type` setup, `@container` rules, removal of `.kcard-headline*` and `.kcard-actions` rules
- `templates/dashboard/js/pipeline.js` — `buildKanbanCard` (~line 848 in F480 baseline; current main: ~line 880), new `buildStatusRowHtml`, removed `buildAgentSectionHtml` agent-row noise for non-fleet
- `templates/dashboard/js/utils.js` — delete `buildCardHeadlineHtml`
- `templates/dashboard/js/actions.js` — `renderActionButtons` integration; primary vs scoped action separation lives here, not in `pipeline.js`
- `lib/card-headline.js` — vocabulary only (already merged); do not change

**Migration (mirrors F480's plan but with width verification at every step):**

1. **CSS first** — raise the `.kanban` floor to 300px, add 380px cap, set up `.kcard { container-type: inline-size }`, add empty `@container` rules. No rendering changes. Restart server. Screenshot at 1280px and 2560px viewports — verify column counts shift sensibly.
2. **Status-row mapping behind feature flag** — implement `buildStatusRowHtml`, render it at `?cards=v2` only. Screenshot every state listed in Acceptance Criteria § State coverage at 300px column width. Compare side-by-side against current 3-zone design.
3. **Sequential pipeline chips** — `.machip` inline chips. Screenshot.
4. **Action-row wrap** — wire `flex-wrap` + `@container` so cs-r wraps below cs-l when crowded. Force a worst-case test fixture (2 agents + nudge + workflow scoped action + overflow) and screenshot at 300/340/380.
5. **Fleet rows** — slim per-agent rows below the new shell.
6. **Autonomous stage track** — inline below status row.
7. **Dependency chips** — `.dep-id` chips below status row (or in a `<div class="cd">` detail line if a dep + cardHeadline detail both apply).
8. **Inbox/backlog visual treatment** — implement the "looks intentional" choice; screenshot all three widths.
9. **Flip default and clean up** — remove `?cards=v2`, delete `buildCardHeadlineHtml`, delete legacy CSS, run full pre-push gate.

**Key invariants** (carried forward from F480's spec, since they were correct):
- `validActions` server payload drives all CTAs.
- `>_` only when the agent's tmux session is live.
- Dependency chip visuals come from `feature.blockedBy` for display; Start enable/disable stays tied to `validActions`.
- Dashboard is read-only — no spec/log parsing in JS.

**What F480 missed (call-outs):**
- F480's wireframe was 380px cards; production columns floor at 220px. This feature must be tested at the actual rendered column widths *during* implementation, not just at the wireframe width.
- F480 had `cs-r { flex-shrink: 0 }` which guaranteed overflow on narrow cards. This feature must not reintroduce that.
- F480 left 8 Playwright e2e failures unresolved at merge. This feature's pre-push gate must clear them all.
- F480 used a hidden `▾` toggle slot that did nothing. Don't render placeholder UI without a connected drawer.

## Dependencies

- None. F480 is reverted; this feature starts from main as it stood before F480's merge.

## Out of Scope

- Spec drawer, monitor view, detail tabs, kanban column header layout — unchanged.
- `▾` expand drawer (separate feature if/when wanted; don't render the slot here without it).
- `lib/card-headline.js` vocabulary changes (already merged, stable).
- `lib/dashboard-status-collector.js` server payload shape changes.
- Replacement of `openTerminalPanel(...)` transport.

## Open Questions

- **Inbox/backlog visual treatment**: center the cs-r group, fold CTA into title row, or render a subtle "needs prioritisation" / "ready" label on the left? Default: try centered cs-r first; fall back to the badge-in-title approach if centred CTAs read as floating.
- **Wrap row styling**: does the wrap row visually align with cs-r's right edge, or left-align under cs-l? Default: right-align under cs-r so the user's eye stays on the action zone.
- **Container-query browser support**: Aigon's supported browser baseline includes Safari 16+/Chrome 105+ (both ship `@container`). Confirm with the user before relying on it; fallback if needed is a `ResizeObserver`-driven class toggle on `.kcard`.

## Related

- Reverted prior attempt: `docs/specs/features/05-done/feature-480-dashboard-card-structural-redesign-collapse-3-zone-layout-to-2-row-design.md` (merged 4b40e167, reverted 66c69e32 on 2026-05-07)
- Design reference: `docs/card-design-wireframe.html` (canonical, on main)
- Set: <!-- standalone -->
