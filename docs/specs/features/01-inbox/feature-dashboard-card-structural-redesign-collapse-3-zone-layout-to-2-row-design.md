---
complexity: high
---

# Feature: Dashboard card structural redesign — collapse 3-zone layout to 2-row design

## Summary

Every pipeline card currently renders three separate DOM zones — a headline banner block,
an agent-status row, and a standalone action-button row — that repeat the same two facts
(state and agent). This feature collapses those three zones into a 2-row design: a title
row (ID + name + ▾ expand toggle) and a single status row (icon + state label + agent chip
with liveness dot + duration + `>_` terminal button + CTA + `···`), with an optional italic
detail line only when it adds genuinely new information. The design reference is
`docs/card-design-wireframe.html` — read it in full before touching any card code.

## User Stories

- [ ] As a user scanning the board, I can see the state, agent, and primary CTA for any card in one glance without reading three separate zones.
- [ ] As a user with a sequential pipeline (CC implements → GG reviews), I can see both agents' states as inline chips (done agents muted, active agent with liveness dot) without separate rows.
- [ ] As a user watching a fleet of researchers, I can see each agent's individual progress and open their tmux session from their row via `>_`.
- [ ] As a user with blocked backlog features, I see `after #XX` dependency chips that are teal when the dep is closed and plain when pending — Start is greyed until all deps are resolved.
- [ ] As a user in autonomous mode, I can always see the stage track with per-stage agent attribution and open the conductor's tmux session.

## Acceptance Criteria

- [ ] Each card renders exactly 2–3 rows maximum: title row, status row, optional detail line.
- [ ] The separate `kcard-headline` banner block is gone — state info is in the status row only.
- [ ] The separate agent-status row below the banner is gone — agent chip is inline in the status row.
- [ ] The standalone action-button row is gone — CTA is inline in the status row right side.
- [ ] `>_` button (not 👁) appears only when an active tmux session exists for that agent; opens the session.
- [ ] Multi-agent sequential pipeline: inline chips `CC ✓ · GG ●` where done = muted, active = liveness dot; detail line names the active action.
- [ ] Fleet cards: per-agent rows below summary headline, each with liveness dot + `>_` (as now, but using new status row structure for the headline).
- [ ] Research fleet (RF1/RF2): same fleet row pattern, "Research ready" label, Evaluate CTA when all done.
- [ ] Autonomous stage track always visible on I-cards, shows `✓ Stage · Agent` per completed stage.
- [ ] Dependency chips: `after #XX` — teal when dep closed, plain when pending, Start greyed until all resolved.
- [ ] Feature set wrapper: teal-bordered container; expanded view shows full feature cards (not compact rows).
- [ ] Playwright screenshots verified for: implementing, implemented, code-reviewed, fleet-running, fleet-all-done, sequential-reviewing, autonomous-running, autonomous-all-done, blocked-dep, feature-set-expanded.
- [ ] `npm test` passes. No visual regressions on other dashboard surfaces.

## Validation

```bash
npm run test:iterate
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.
- May update CSS in `templates/dashboard/index.html` alongside `pipeline.js` changes without a separate commit.

## Technical Approach

**Reference**: `docs/card-design-wireframe.html` — open it at `http://localhost:7654/card-design-wireframe.html`
(serve: `python3 -m http.server 7654 --directory docs`). Do not deviate from it without
discussing with the user first.

**Primary files:**
- `templates/dashboard/js/pipeline.js` — `buildFeatureCard`, `buildSoloAgentCard`, `buildResearchCard`, fleet card builders
- `templates/dashboard/index.html` — CSS additions for `.machip`, `.dep`, `.dep-id`, `.term`, `.set-wrap`, `.set-body`, `.cstages` with agent attribution
- `lib/card-headline.js` — already updated; read-only for this feature

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
invent button logic client-side. The `>_` button only renders when `agent.sessionName`
resolves to a live tmux session (use existing `sessionExists` check pattern).

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
