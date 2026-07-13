# dash-ux — Dashboard card & board UX redesign (proposal, paused)

**Status:** proposal complete, awaiting direction decision. No specs created yet, no code changed.
**Date:** 2026-07-12/13 · **Published artifact:** https://claude.ai/code/artifact/b832c55e-18c6-4c8d-b84b-fe8864fcbe76 (same content as `proposal.html` here)

## Why

Four months of incremental capability (feature sets, autonomous features, autonomous sets) has made
feature/research pipeline cards visually cluttered: current activity, past steps, actions, and
click targets all compete on one ~220px-wide card, and it is hard to tell what state an item is in.

## What was done this session

1. **Code/docs review**: `templates/dashboard/js/pipeline.js` (2,408 lines, `buildKanbanCard`),
   `lib/card-presentation.js` + `lib/card-headline.js` (F650 server-owned presentation model),
   `templates/dashboard/styles/kanban.css`, `docs/dashboard-card-design.md`,
   `docs/card-design-wireframe.html` (~60 documented card states), architecture.md § Dashboard Frontend.
2. **Live inspection**: real board at aigon.localhost, plus an ephemeral e2e mock sandbox
   (`tests/dashboard-e2e/bootstrap.js runGlobalSetup()`, mock agents with
   `MOCK_AGENT_PROFILE=never-submit` to freeze "implementing" states). Drove fleet (F3 cc+cx),
   solo (F12), autonomous (`feature-autonomous-start 17 cc`), set-tagged features
   (`set: onboarding` frontmatter), group-by-set view, and the spec drawer.
   Evidence in `screenshots/`. Sandbox has been torn down.

## Diagnosis (5 root problems)

- **P1 Redundant narration** — headline + autonomous controller panel + plan section + agent rows
  all restate "implementing" on one card.
- **P2 No altitude separation** — the card is tile + history log + control panel at once, while the
  spec drawer already has 8 detail tabs the card duplicates instead of pointing at.
- **P3 Uniform columns, non-uniform attention** — `repeat(5, minmax(220px,1fr))`; empty Evaluation
  gets the same width as overflowing In-Progress; Closed clips off-screen at 1680px.
- **P4 Set chrome tax** — group-by-set repeats a ~150px set header (3 buttons + 2 status rows +
  progress bar) per set **per column**.
- **P5 No enforced vocabulary** — cards are string-concatenated in `pipeline.js` with a forked
  variant in `monitor.js`; nothing structurally prevents clutter re-accreting.

## Proposal (see `proposal.html` for rendered mockups)

Design model: **glance / focus / act**. A resting card answers only: what is this, what's happening
now, does it need me, what's the one next action. Everything else moves one gesture away.

Concepts:
- **A — Attention-weighted board** (recommended): In-Progress/Evaluation 2–3× width; Inbox/Closed
  collapse to narrow rails; empty columns collapse; rail pinning in localStorage.
- **B — Two-state cards** (recommended): collapsed 4-line tile by default; chevron expands to
  sessions/timeline/checks; severity ≥ attention auto-expands; state persists through
  `reconcileKeyedCards` keyed by feature id.
- **C — Docked inspector** (phase 2): slim cards + existing drawer docked as persistent right
  panel, j/k navigation.
- **D — Stage swimlanes** (radical alternative, prototype-only): stages as horizontal lanes,
  In-Progress cards get full board width.
- **E — Set bands** (recommended): one full-width band per set spanning stage columns; set controls
  and conductor status appear once in the band header.

Pattern reference deliverable: `docs/dashboard-design-system.md` + live component gallery (evolve
`card-design-wireframe.html` into a served page, also the visual-regression surface) + extracted
`templates/dashboard/js/components/` shared by pipeline and monitor.

## Proposed feature set (`dash-ux`, dependency order)

1. **design-system-foundation** — pattern doc, token audit, component gallery, `js/components/` vocabulary
2. **card-anatomy-v2** — strict collapsed card, agent chips, milestone strip, single primary action (dep: 1)
3. **card-expand-collapse** — two-state cards + persistence (dep: 2)
4. **attention-weighted-board** — weighted grid, rails, empty-column collapse (dep: 2)
5. **set-bands** — single-header set bands + conductor status home (dep: 2)
6. **monitor-pipeline-unification** — monitor re-rendered from shared components (dep: 2)
7. **docked-inspector** — phase 2 (dep: 3, 4)

**Recommendation:** ship A+B+E (features 1–6); hold C for phase 2; prototype D behind a toggle only
if fleet/autonomous density keeps growing.

## To resume

1. Get a direction decision (A+B+E core? add C? add D prototype? revisions?). The session paused on
   exactly this question.
2. Then create the set: `aigon feature-create <name>` per feature above, tag specs with
   `set: dash-ux` frontmatter, add `after:` dependencies per the table, and run
   `aigon feature-spec-review` before starting.
3. Useful reproduction: boot the mock sandbox via
   `node -e "require('./tests/dashboard-e2e/bootstrap').runGlobalSetup()"`, then run CLI against it
   with `HOME=<tempHome from /tmp/aigon-dashboard-e2e-ctx.json>` and
   `MOCK_AGENT_PROFILE=never-submit` to freeze implementing states; clean up with
   `node -e "require('./tests/dashboard-e2e/teardown')()"`.
   Note: after seeding, `aigon spec-view` may need a run before `feature-prioritise` finds inbox
   specs in the sandbox (stale symlink view — possibly a real bug worth checking separately).

## Files

- `proposal.html` — the full proposal with CSS mockups (open in a browser)
- `screenshots/sandbox-pipeline-busy.jpeg` — full busy board (Closed column clipping visible)
- `screenshots/sandbox-inprogress-col.jpeg` — 220px in-progress column: fleet + solo + autonomous cards
- `screenshots/sandbox-f17-autonomous.jpeg` — autonomous card stating "implementing" four ways (P1)
- `screenshots/sandbox-groupbyset.jpeg` — set header chrome repeated per column (P4)
- `screenshots/sandbox-drawer-status.jpeg` — existing drawer Status tab (the detail surface cards duplicate, P2)
