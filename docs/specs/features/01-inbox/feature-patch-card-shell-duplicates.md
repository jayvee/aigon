---
complexity: medium
---

# Feature: patch-card-shell-duplicates

## Summary

F489 (`responsive-card-shell-redesign`, merged 2026-05-07) shipped the responsive 2-row
card shell, but the implementation rendered three independent state-display paths on the
same card, two redundant peek/overflow control pairs on solo cards, and centred CTA buttons
mid-card on inbox/backlog rows. This feature patches those defects in place — F489's shell
architecture stays; only the duplicates and alignment regressions are removed. **Do not
revert F489.**

## User Stories

- [ ] As a user looking at a solo in-progress card, I see the state exactly **once** (e.g. just `Implemented · CC · 53s`), with consistent casing across whatever path renders it.
- [ ] As a user clicking on a solo card's peek button, there is exactly **one** eye icon and it is unambiguous which session it opens.
- [ ] As a user opening the overflow on a solo card, there is exactly **one** `···` menu containing all card-level actions.
- [ ] As a user looking at an inbox or backlog card with no active state, the `Start` / `Prioritise` button sits at the right edge of the row, not floating in the middle of dead space.
- [ ] As a user with a fleet (≥ 2 agents) card, per-agent rows still render with their own status, peek, and overflow — multi-agent cards keep the affordances they need.

## Acceptance Criteria

### Defect 1 — Triple state label on solo cards

Image #6 shows three independent render paths for the same state on one solo card:

| Visible text | Source | File:line | Server field |
|---|---|---|---|
| `🔧 Implementing` (inline with `#01 format date`) | `buildStateRenderBadgeHtml` | `templates/dashboard/js/utils.js:93-97` | `feature.stateRenderMeta.badge` (label as tooltip) |
| `IMPLEMENTED · CC · 53s` (status row, uppercase) | `buildStatusLeftHtml` | `templates/dashboard/js/pipeline.js:862-890` | `feature.cardHeadline.verb` |
| `✓ Implemented` (inside agent box) | `buildAgentSectionHtml` | `templates/dashboard/js/pipeline.js:604-…` | per-agent `agent.status` |

- [ ] On solo (single-agent) cards, the state appears in **exactly one** location: the status row (`.kcard-status-row` left side via `buildStatusLeftHtml`). Reads like `[glyph] Implemented · CC · 53s`.
- [ ] `buildStateRenderBadgeHtml` no longer renders the **lifecycle-verb** badge inline with the title on solo cards (the duplicate `🔧 Implementing`). The state-render badge slot stays available for genuinely orthogonal information (e.g. spec drift, scheduled run) — only the lifecycle-verb duplicate is suppressed. The implementer must read `lib/state-render-meta.js` (or equivalent) to identify which `stateRenderMeta` codes are lifecycle-verb duplicates of `cardHeadline.verb` and which are independent signals worth keeping.
- [ ] The agent-section's per-agent status row (`✓ Implemented` in image #6) is hidden when `agents.length === 1`. The agent-section box itself may stay if it carries other content (model name, etc.), but its status pill is removed.
- [ ] Status-row left side picks up the glyph from `feature.cardHeadline.glyph` (already populated by `lib/card-headline.js`) so the status icon is preserved when the inline state-render badge is suppressed.
- [ ] No new server payload fields. The patch only suppresses redundant render paths; `stateRenderMeta`, `cardHeadline`, and per-agent `status` all remain populated server-side.

### Defect 2 — Casing drift across render paths

- [ ] `text-transform: uppercase` removed from `.kcard-status-left` in `templates/dashboard/styles.css`. State labels render in **sentence case** consistently (`Implemented`, not `IMPLEMENTED`).
- [ ] `lib/card-headline.js` verbs continue to be authored in sentence case in source; the dashboard does not synthesise either uppercase or title case at render time.
- [ ] Any test fixture or selector that asserted on uppercase text (e.g. `getByText('IMPLEMENTED')`) is updated.

### Defect 3 — Duplicate eye / peek icons on solo cards

Image #6 shows `👁` next to the card-level `Close` button AND `👁` next to "Claude Code" inside the agent section box — both open the same tmux session for solo features.

- [ ] On solo cards: render the peek button **once**, in the card-level status row. The agent-section peek button is hidden when the card is solo.
- [ ] On fleet cards: per-agent peek buttons remain (each agent has its own session).
- [ ] When a solo card has no live tmux session (`agent.tmuxRunning !== true` or no `tmuxSession`), no peek button renders at all — neither at card level nor agent level.

### Defect 4 — Duplicate overflow menus on solo cards

Image #6 shows a card-level `···` AND an agent-level `···` inside the agent-section box on a solo card.

- [ ] On solo cards: render the overflow `···` **once**, at the card level. The agent-section overflow is hidden.
- [ ] On fleet cards: per-agent overflows remain.
- [ ] Card-level overflow continues to source its menu items from `feature.validActions` via `renderActionButtons`. No client-side button logic.

### Defect 5 — CTA centred mid-card on inbox/backlog rows

Image #4 shows backlog cards (`#463`, `#464`, `#465`, `#466`) where the `Start [···]` group sits centred-left in dead space. Two CSS rules are responsible:

- `templates/dashboard/styles.css:321` — `.kcard-status-row.is-empty-card{justify-content:center;padding:4px 0}`
- `templates/dashboard/styles.css:430` — `@container card (max-width: 330px) { .kcard-status-row.is-empty-card .kcard-status-right{justify-content:center} }`

- [ ] Line 321: `justify-content: center` → `justify-content: flex-end`. Empty-card status rows align the action group to the right edge.
- [ ] Line 430: `justify-content: center` → `justify-content: flex-end`. Narrow-column container query stops re-centring; behaviour stays consistent across widths.
- [ ] Visual verification: at 280px, 320px, 380px column widths, the inbox/backlog `Start` and `Prioritise` buttons sit at the card's right edge with the `···` overflow flush against them. No "floating in dead space" state remains.
- [ ] Set-member cards in a backlog set (e.g. the `DEEPEN-CREATE` 0/4 set wrapper) inherit the same fix — set wrappers do not introduce a separate centring rule.

### Cross-cutting verification

- [ ] Playwright screenshots captured for the solo lifecycle at three column widths (280/320/380) covering: inbox, backlog, in-progress, in-evaluation, closed, blocked-by-dep, set-member.
- [ ] Playwright screenshots for fleet (≥ 2 agents): in-progress fleet, fleet-all-done, sequential cc → gg, autonomous run.
- [ ] Solo screenshots show **one** state label, **one** eye icon, **one** overflow menu. Fleet screenshots still show per-agent rows with their own state/peek/overflow.
- [ ] `npm run test:iterate` passes through every iteration.
- [ ] Pre-push gate: `npm run test:deploy` passes before merge.

## Validation

```bash
npm run test:iterate
npm run test:deploy
```

## Pre-authorised

- May skip `npm run test:browser` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright runs at the deploy gate.
- May update Playwright fixture selectors that asserted on uppercase state text (`IMPLEMENTED`, `RUNNING`, etc.) to sentence case in the same commit as the CSS change.

## Technical Approach

**F489 stays.** The shell, container queries, column floor/cap, and 2-row layout are correct.
This patch only removes redundant DOM in the solo path and corrects two CSS alignment bugs.

**Primary files:**
- `templates/dashboard/js/pipeline.js` — solo-vs-fleet branch in `buildKanbanCard`; suppress `buildCardHeadlineHtml` + `buildAgentSectionHtml` content (or their status/peek/overflow children) when `agents.length === 1`. Status row's left-side glyph slot picks up the F489 `cardHeadline.glyph`.
- `templates/dashboard/js/actions.js` — no changes expected; `renderActionButtons` already drives card-level actions.
- `templates/dashboard/styles.css` — two `justify-content` flips (lines 321 and 430), one `text-transform: uppercase` removal on `.kcard-status-left`, plus any selector updates required when the agent-section subtree is hidden on solo.
- `tests/dashboard-snapshots/**` (or wherever Playwright fixtures live) — update casing-sensitive selectors.

**Solo detection — important.** `pipeline.js` already has an `isSoloDriveBranch` predicate at line 970:
```
const isSoloDriveBranch = agents.length === 1 && agents[0].id === 'solo' && !agents[0].tmuxSession;
```
This is **too narrow** — it only matches `agent.id === 'solo'` with no tmux session. A normal **cc-in-worktree** card has `agents.length === 1` and a live tmux session but `agents[0].id === 'cc'`, so `isSoloDriveBranch === false` — and the card falls into the `agents.length === 1 && !isSoloDriveBranch` branch at line 1074, which renders `buildAgentSectionHtml` for the lone agent. **That is the duplicate eye/overflow source.**

The patch should introduce a broader **`isSoloCard`** predicate:
```
const isSoloCard = agents.length === 1 && !isFleet;
```
…and use it to gate the agent-section render at line 1077, the inline state-render badge in the title row at line 1005 (lifecycle-verb cases only), and the agent-section's status/peek/overflow children for defects 1/3/4. The existing `isSoloDriveBranch` stays for whatever else uses it (it has a more specific meaning).

**Edge case — eval-promoted from solo:** when a feature transitions through eval, `agents.length` may temporarily be 1 with `feature.evalSession.running === true`. Confirm by inspection that the `isFleet` flag at line 971 (`agents.length > 1 && (feature.evalSession || feature.winnerAgent)`) correctly classifies this case before relying on `isSoloCard`. If it doesn't, broaden `isSoloCard` to also require `!feature.evalSession`.

**What this patch is NOT:**
- It is not a re-redesign. The 2-row shell stays.
- It is not a per-state vocabulary change. `lib/card-headline.js` stays put.
- It is not a server-side change. No new payload fields, no new endpoints.

## Dependencies

- F489 (`feature-489-responsive-card-shell-redesign.md`, status: done) — this patch builds on its shell.

## Out of Scope

- Spec drawer, monitor view, settings, sessions tab — unchanged.
- Vocabulary / verb wording changes in `lib/card-headline.js`.
- Column floor / cap / container-query thresholds — F489 set those; this patch leaves them.
- Fleet card layout — fleet cards remain unchanged. Only solo cards lose the duplicates.

## Open Questions

- **`stateRenderMeta` lifecycle-verb classification**: which `stateRenderMeta` codes count as duplicates of `cardHeadline.verb` and should be suppressed inline, vs which carry orthogonal information that should still render? Implementer must enumerate and decide. Default for ambiguous cases: suppress when the badge text and `cardHeadline.verb` map to the same lifecycle phase; keep when the badge surfaces a distinct condition (drift, schedule, error) not in the headline.
- **Solo + autonomous (single agent + autonomous plan)**: keep the autonomous stage track below the status row — it carries plan information, not duplicate state. Verify the running stage's verb does not also render in the inline state-render badge. If it does, suppress the inline badge in this case too (autonomous run is still a "solo card" for purposes of this patch).

## Related

- Builds on: F489 `feature-489-responsive-card-shell-redesign.md` (in `05-done`)
- Original failed redesign: F480 `feature-480-…layout-to-2-row-design.md` (in `05-done`, REVERTED via `66c69e32` then re-attempted as F489)
- Design reference: `docs/card-design-wireframe.html` (canonical, on main)
- Set: <!-- standalone -->
