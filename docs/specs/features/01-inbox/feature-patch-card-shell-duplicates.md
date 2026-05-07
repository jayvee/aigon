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

Image #6 shows `🔧 Implementing` (inline with title) AND `IMPLEMENTED · CC · 53s` (status row, uppercase) AND `✓ Implemented` (in agent section box) — three render paths for the same state on one solo card.

- [ ] On solo / single-agent cards (`agents.length === 1`), the state appears in **exactly one** location: the status row (`.kcard-status-row` left side). Reads like `[icon] Implemented · CC · 53s`.
- [ ] The inline-with-title headline (`buildCardHeadlineHtml` glyph + verb in the title row, e.g. `🔧 Implementing`) is removed for solo cards. Glyph migrates into the status row's left side so the status icon is preserved.
- [ ] The agent-section's per-agent status (`buildAgentSectionHtml` `✓ Implemented`) is hidden when the card is solo. Multi-agent (fleet) cards keep per-agent statuses.
- [ ] No new server payload fields. State display continues to read from `feature.cardHeadline` (verb/glyph/owner/age) and per-agent `agent.status` only — and only one of those wins per card.

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

**Solo detection:** the relevant condition is **`agents.length === 1`** — every single-agent card has the same duplicate-render problem regardless of which agent is assigned. Confirm this assumption against fleet-promoted-from-solo edge cases (`feature-eval` flow) before relying on it.

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

- **Glyph location after dropping the inline title-row headline**: drop the glyph entirely, or move it into the status row's left side (e.g. `🔧 Implemented · CC · 53s`)? Default: move into status row, prefix the label.
- **Solo + autonomous (single agent + autonomous plan)**: do we still want the autonomous stage track below the status row? Yes — it carries plan information, not duplicate state. Verify it does not double-up with the status row's verb.
- **Fleet sequential (`agents.length === 2`, one done + one active)**: fleet behaviour is preserved, but check the duplicate problem doesn't reappear on the *active* agent's row when the cardHeadline already names that agent. Default: per-agent rows always render their own status; the cardHeadline's owner field is the *primary* agent only.

## Related

- Builds on: F489 `feature-489-responsive-card-shell-redesign.md` (in `05-done`)
- Original failed redesign: F480 `feature-480-…layout-to-2-row-design.md` (in `05-done`, REVERTED via `66c69e32` then re-attempted as F489)
- Design reference: `docs/card-design-wireframe.html` (canonical, on main)
- Set: <!-- standalone -->
