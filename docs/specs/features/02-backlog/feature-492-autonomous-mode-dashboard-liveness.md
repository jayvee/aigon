---
complexity: high
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-07T21:38:29.450Z", actor: "cli/feature-prioritise" }
---

# Feature: autonomous-mode-dashboard-liveness

## Summary

Autonomous mode cards are visually inert — a card running a multi-stage autonomous pipeline looks identical to a stalled or paused card. Three concrete gaps: (1) no stage track showing which autonomous stage is active vs complete, (2) no liveness cues (pulsing dot, elapsed duration) on the running card, (3) autonomous features park at the close gate expecting a human click instead of auto-progressing to done. This feature adds the autonomous stage track to in-progress cards, wires in the existing server-side `autonomousPlan.stages` data, adds a live pulsing dot + `· Xm` duration badge, and makes the autonomous conductor auto-close when the close gate is reached.

## User Stories

- [ ] As a user watching an autonomous feature run, I can see a stage track (`✓ Spec → ● Implement → ○ Review → ○ Close`) on the card so I know which phase it's currently on without opening a terminal.
- [ ] As a user with an autonomous feature running, I see a pulsing green dot and elapsed time (`● Implementing · 14m`) so I can tell at a glance that the agent is actively working.
- [ ] As a user who launched a feature in autonomous mode, I expect it to reach `done` without me having to click `Close` — the conductor should auto-progress past the close gate.

## Acceptance Criteria

- [ ] In-progress autonomous cards render a stage track below the headline: each stage shows its label, a glyph (`✓` complete / `●` running / `○` waiting), and the running stage is visually highlighted. Data source: `feature.autonomousPlan.stages` from the API.
- [ ] Non-autonomous cards are unaffected — stage track only renders when `feature.autonomousPlan` is present.
- [ ] A pulsing `.dot.live` element appears next to the agent name (or status row) whenever `agent.tmuxRunning === true` and the agent is not in a done state.
- [ ] The status row shows elapsed time as `· Xm` when `cardHeadline.age` is available and the card is in a running state.
- [ ] The autonomous conductor (`lib/set-conductor.js` or equivalent) auto-triggers `feature-close` when it reaches the close gate, rather than setting `CLOSE_GATE` state and waiting for a human click. If close fails, it surfaces the failure on the card as it does today.
- [ ] Playwright snapshot covers: autonomous card with all stages complete (pre-close), autonomous card mid-implement stage, non-autonomous card (regression).
- [ ] `npm run test:core` passes.

## Validation

```bash
npm run test:quick
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.
- May edit `templates/dashboard/js/pipeline.js`, `templates/dashboard/js/autonomous-plan.js`, `templates/dashboard/styles.css` to add stage track and liveness dot rendering.
- May edit `lib/set-conductor.js` (or the equivalent conductor module) to auto-trigger close at the close gate.

## Technical Approach

**Stage track (client-only):** `feature.autonomousPlan.stages` is already plumbed from `workflow-read-model.js` → `dashboard-status-collector.js` → API. `templates/dashboard/js/autonomous-plan.js` has a partial implementation. Wire it into `buildKanbanCard` in `pipeline.js` below the headline, rendering a compact horizontal stage track. Use existing `STAGE_VERBS` map in `card-headline.js` for stage labels.

**Liveness dot:** Add a `.dot.live` CSS animation (pulsing green circle, ~8px). Render it in `buildAgentSectionHtml` when `agent.tmuxRunning && !IMPLEMENTER_DONE_STATUSES.has(agent.status)`. Keep it beside the agent name in the card header.

**Elapsed duration:** `cardHeadline.age` (seconds since status change) is already computed server-side. Render as `· Xm` in the status row when tone is `running` and age is non-null. Use the existing `formatHeadlineAge` helper in `utils.js`.

**Auto-close at close gate:** Locate where the conductor transitions to close-gate state and add an immediate `feature-close` invocation instead of (or after) setting the gate state. Preserve the existing failure-surfacing path — if close fails, the card shows the close failure as today.

**Complexity note:** `high` because this touches the conductor (engine-adjacent write path), two dashboard JS modules, CSS, and requires Playwright verification of the new autonomous card states.

## Dependencies

- `feature.autonomousPlan` is already served by the API (verified against `workflow-read-model.js`).
- `cardHeadline.age` is already computed in `lib/card-headline.js`.

## Out of Scope

- Tone palette unification (separate item from the F489/F490 revert tally — different complexity).
- Peek-button alignment and overflow dropdown positioning (cosmetic, separate feature).
- Engine vocabulary leaks (`REVISION GATE` etc.) — separate feature.
- Any changes to the autonomous plan's stage sequencing or conductor scheduling logic beyond the auto-close trigger.

## Open Questions

- Should the auto-close be gated on a config flag (e.g. `autonomous.autoClose: true`) so users can opt out and review before closing? Or unconditional for all autonomous runs? Suggest unconditional — autonomous mode means hands-off; a failed close already surfaces on the card.

## Related

- Research: none
- Set: none
- Prior context: F489, F490 reverted (2026-05-07) — autonomous stage track was identified as the biggest missing liveness cue in that session.
