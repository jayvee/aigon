---
complexity: high
planning_context: ~/.claude/plans/foamy-foraging-blossom.md
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-29T13:49:06.025Z", actor: "cli/feature-prioritise" }
---

# Feature: card-current-activity-headline

## Summary

Every kanban card today buries its current activity in a tiny inline badge inside `.kcard-name` (e.g. `✍️ Addressing review`) — smaller than the title and visually indistinguishable from metadata. The richest "what is happening right now" data (autonomous stage status, per-agent tmux state, idle ladder, awaiting-input, blockers, eval pick-winner, close failures) lives lower on the card or isn't surfaced at all. This feature replaces the inline badge with a single prominent **headline banner** rendered uniformly on every card variant — fleet, drive, dormant, all lanes, feature/research/feedback, recurring, pre-engine, drifted — driven by one server-side function with explicit precedence rules and a state-sensitive verb (RUNNING / WAITING / NEEDS YOU / BLOCKED / READY / DONE).

## User Stories

- [ ] As a user scanning the dashboard, I can tell at a glance what each card is doing right now without reading the title or expanding panels.
- [ ] As a user, the headline tells me the verb (running/waiting/blocked/ready), the subject (which stage/phase), the owner (which agent or "you"), and the age — in that order, every time.
- [ ] As a user, every card variant — autonomous, drive, inbox, backlog, in-progress, review, done, blocked, drifted, recurring, missing-snapshot — gets the same headline shape and visual placement, so I never have to learn a per-variant convention.
- [ ] As a user, when human action is needed (awaiting input, pending confirmation, pick-winner, review-complete-needs-apply), the banner uses an attention tone so those cards are visibly distinct from idle/running ones.
- [ ] As a user, when a card is in a warn state (close failed, rebase needed, spec drift, missing engine state, failed stage), the banner takes a warn tone and supersedes any other signal.

## Acceptance Criteria

- [ ] A new pure function `lib/card-headline.js#computeCardHeadline(entity, snapshot, agents, autonomousPlan, lane)` returns the headline tuple `{ tone, glyph, verb, subject, owner, age, detail }`.
- [ ] `lib/dashboard-status-collector.js` attaches `entity.cardHeadline` to every feature, research, and feedback row alongside the existing `stateRenderMeta`.
- [ ] `templates/dashboard/js/utils.js` exposes `buildCardHeadlineHtml(item)` returning the banner block; `buildStateRenderBadgeHtml` is no longer called by `pipeline.js`.
- [ ] `templates/dashboard/js/pipeline.js#buildKanbanCard` renders the headline banner once per card, after `.kcard-name` and before `blockedByHtml` / `autonomousPlanHtml`, at a single insertion point above the fleet/drive/dormant fork. The inline `kcard-state-badge` is removed.
- [ ] CSS adds `.kcard-headline` plus per-tone variants (`tone-running`, `tone-waiting`, `tone-attention`, `tone-blocked`, `tone-warn`, `tone-ready`, `tone-done`, `tone-idle`) reusing existing palette tokens. Visual treatment designed via the `frontend-design` skill.
- [ ] Precedence rules (see Technical Approach) are exercised by unit tests with at least one case per rule plus key combinations: warn supersedes running, awaiting-input wins over running, idle ladder upgrades drive tone to attention, age omitted when timestamp missing, lifecycle fallback when no richer signal.
- [ ] E2E specs assert the headline content for: solo lifecycle (`solo-lifecycle.spec.js`), fleet lifecycle (`fleet-lifecycle.spec.js`), failure modes (`failure-modes.spec.js`), workflow lanes (`workflow-e2e.spec.js`).
- [ ] One `mcp__playwright__browser_snapshot` per lane confirms the banner appears once per card and the inline badge is gone, with no regressions to other card sections.
- [ ] The `dashboard-status-collector` integration test fixture confirms `cardHeadline` is attached and matches expected tone for each lifecycle state in `STATE_RENDER_META`.

## Validation

```bash
node --check lib/card-headline.js
npm test -- card-headline
npm run test:iterate
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Technical Approach

### Unified contract

```js
{
  tone:    'running' | 'waiting' | 'attention' | 'blocked' | 'warn' | 'ready' | 'done' | 'idle',
  glyph:   '▶' | '◐' | '⚠' | '✓' | '○',
  verb:    'RUNNING' | 'WAITING' | 'NEEDS YOU' | 'BLOCKED' | 'READY TO CLOSE' | 'DONE' |
           'READY TO START' | 'NEEDS PRIORITISATION' | 'NEEDS TRIAGE' | 'PICK WINNER' |
           'CONFIRM <SIGNAL>' | 'CLOSE FAILED' | 'REBASE NEEDED' | 'SPEC DRIFT' |
           'NO ENGINE STATE' | 'IDLE' | 'FINISHED (UNCONFIRMED)',
  subject: string | null,   // 'Implement', 'Revision', 'Review', 'Eval'
  owner:   string | null,   // agent id like 'CC', or 'you', or null
  age:     number | null,   // seconds since current state began; null if unknown
  detail:  string | null,   // optional sub-line — message, reason, "step 3 of 4"
}
```

Render: full-width banner under the title with a 4px coloured left rail keyed by `tone`. Top line `{glyph} {VERB}`; second line `{subject} · {owner} · {age}`; optional third line `{detail}`. Missing fields are silently omitted — never fabricated.

### Precedence — first match wins

1. **Warn-class** (always supersedes): `lastCloseFailure` → `CLOSE FAILED`; `rebaseNeeded` → `REBASE NEEDED`; `specDrift` → `SPEC DRIFT`; `currentSpecState === 'close_recovery_in_progress'` → `RECOVERING CLOSE`; missing-snapshot past backlog → `NO ENGINE STATE` · "run aigon doctor --fix".
2. **Lane-terminal:** `done` → `DONE` (age = closedAt); feedback `wont-fix` → `WON'T FIX`.
3. **Awaiting human input:** any agent has `awaitingInput.message` → `NEEDS YOU` · owner = agent · detail = message.
4. **Pending manual confirmation:** any agent has `pendingCompletionSignal` and `!isWorking` → `CONFIRM <SIGNAL>` · owner = agent · detail = "Mark X complete".
5. **Eval pick-winner:** `evalStatus === 'pick winner'` → `PICK WINNER` · detail = winner recommendation.
6. **Lane = inbox:** feature/research → `NEEDS PRIORITISATION`; feedback → `NEEDS TRIAGE`.
7. **Lane = backlog:** `blockedBy.length > 0` → `BLOCKED` · detail = "waiting on #N, #M"; else → `READY TO START`.
8. **Lane = in-progress (autonomous, has stages):** running stage → `RUNNING · {STAGE}` · owner · age; failed stage → `{STAGE} FAILED` (warn); waiting stage with prior complete → `{STAGE} GATE`; all complete → `READY TO CLOSE`.
9. **Lane = in-progress (drive/solo):** map `agent.status` → verb; layer flags: `sessionEnded` while implementing → `FINISHED (UNCONFIRMED)`; `idleLadder.state === 'needs-attention'` → upgrade to attention; `idleLadder.state === 'idle'` → `IDLE` · age = idleSec.
10. **Lane = in-evaluation (research):** same shape as rule 8 against research stages.
11. **Fallback:** existing `STATE_RENDER_META` lifecycle entry → tone derived from `cls`, verb = uppercased label.

### Variant coverage — every card serviced the same

| Variant                                | Lane             | Rule |
|----------------------------------------|------------------|------|
| feature inbox (slug or numeric)        | inbox            | 6    |
| feature backlog ready                  | backlog          | 7    |
| feature backlog blocked by deps        | backlog          | 7    |
| feature autonomous running             | in-progress      | 8    |
| feature autonomous waiting at gate     | in-progress      | 8    |
| feature autonomous failed stage        | in-progress      | 8 (warn) |
| feature drive running                  | in-progress      | 9    |
| feature drive submitted / awaiting     | in-progress      | 9    |
| feature drive idle / silent agent      | in-progress      | 9    |
| feature drive session ended unconfirmed| in-progress      | 9    |
| feature awaiting human input           | any in-progress  | 3    |
| feature pending completion confirm     | any in-progress  | 4    |
| feature eval pick-winner               | in-progress      | 5    |
| feature ready to close                 | in-progress      | 8    |
| feature close failed                   | any              | 1    |
| feature rebase needed                  | any              | 1    |
| feature spec drift                     | any              | 1    |
| feature done                           | done             | 2    |
| research (all lanes)                   | matches feature  | 6/7/8/10/2 |
| feedback inbox                         | inbox            | 6    |
| feedback triaged / actionable          | triaged/actionable | 11 |
| feedback won't-fix                     | won't-fix        | 2    |
| recurring feature                      | normal lanes     | as feature |
| missing-snapshot row in inbox/backlog  | inbox/backlog    | 6/7  |
| missing-snapshot row past backlog      | any              | 1    |

### Files to modify

- **NEW** `lib/card-headline.js` — pure `computeCardHeadline(entity, snapshot, agents, autonomousPlan, lane)`. No I/O.
- `lib/dashboard-status-collector.js` (~line 892) — attach `entity.cardHeadline`. Keep `stateRenderMeta` populated for agent-status spans.
- `templates/dashboard/js/utils.js` (~line 93) — add `buildCardHeadlineHtml(item)`. `buildStateRenderBadgeHtml` retained only as a transitional fallback (no callers in `pipeline.js` after this change).
- `templates/dashboard/js/pipeline.js` (line 838 in `buildKanbanCard`) — single insertion point above the fleet (line 843) / drive (line 911) / dormant (line 941) fork; remove inline `+ buildStateRenderBadgeHtml(feature)` from the `.kcard-name` line.
- `templates/dashboard/css/pipeline.css` — `.kcard-headline` + per-tone classes via `Skill(frontend-design)`.

### Implementation order

1. Build `lib/card-headline.js` + unit tests; `npm test` green.
2. Wire into `lib/dashboard-status-collector.js`; `aigon server restart`; `browser_snapshot` smoke.
3. Add `buildCardHeadlineHtml` to `templates/dashboard/js/utils.js`.
4. Insert into `pipeline.js#buildKanbanCard` at one shared point; remove inline badge call.
5. CSS via `Skill(frontend-design)`; iterate per lane via `browser_snapshot`.
6. Extend e2e specs (`solo-lifecycle`, `fleet-lifecycle`, `failure-modes`, `workflow-e2e`).
7. `npm run test:iterate` per iteration; pre-push gate before commit.

## Dependencies

-

## Out of Scope

- Live ticking age — banner inherits the existing dashboard poll cadence.
- Click-through from banner to a detail panel.
- Per-user customisation of which signal to surface.
- Animating tone transitions.
- Updating `aigon` CLI text views (e.g. `feature-list`) to use the same headline.
- Touching spec-drift, scheduled-clock, blocked-by chains, nudge chips, per-agent sections, eval section, or close button — those remain as-is.

## Open Questions

- Do `stage.startedAt` and `agent.statusChangedAt` exist on every snapshot today, or do we need to add them in `lib/workflow-core/` and `lib/dashboard-status-collector.js`? The implementer should grep first; if absent, age silently drops without blocking the feature.
- Does the engine distinguish "stage waiting because upstream isn't done" from "stage waiting because a human must act"? If not, treat all stage `waiting` statuses as queue-style and rely on rules 3/4 to flag human-needed cards.

## Related

- Research:
- Set:
- Prior features in set:
