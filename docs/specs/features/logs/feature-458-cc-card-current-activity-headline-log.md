# Implementation Log: Feature 458 - card-current-activity-headline
Agent: cc

## Status

Solo drive worktree (single agent: cc). Implementation complete; e2e suite re-run in clean state pending verification.

## New API Surface

- `lib/card-headline.js#computeCardHeadline(entity, snapshot, agents, autonomousPlan, lane, opts?)` returns `{tone, glyph, verb, subject, owner, age, detail}`. Pure function, no I/O.
- `entity.cardHeadline` attached on every feature/research/feedback row by `lib/dashboard-status-collector.js`.
- `templates/dashboard/js/utils.js#buildCardHeadlineHtml(item)` renders the banner block.

## Key Decisions

- Inline `buildStateRenderBadgeHtml` is no longer called from `pipeline.js`; the helper is left exported as transitional fallback per spec. The headline banner is inserted once per card after `.kcard-name` and before `blockedByHtml`/`autonomousPlanHtml`, so all three layout branches (fleet/drive/dormant) share a single insertion point.
- Backlog rows have `blockedBy` annotated *after* the initial push, so the collector recomputes the headline once dependency ids are known — keeps the precedence rule in one place.
- Stage-level `startedAt` is not present on `autonomousPlan.stages` today, so age silently drops for stage rules (rule 8), as the spec's open-question allowed.

## Gotchas / Known Issues

- The `idleLadder` "idle" upgrade in rule 9 only fires when the mapped drive status is non-running — guards against demoting an actively-implementing card to IDLE while its tmux is alive.
- The "missing snapshot past backlog" warn rule treats `done` lane as past-backlog; in practice done rows always have a snapshot, so this is a defence rather than a behaviour change.

## Explicitly Deferred

- E2E specs (`solo-lifecycle`, `fleet-lifecycle`, `failure-modes`, `workflow-e2e`) and per-lane `browser_snapshot` checks: deferred to user verification once the dashboard is restarted from main; the current dashboard service runs from the main repo, not this worktree, so banner rendering can only be confirmed end-to-end after merge.
- Stage `startedAt` instrumentation in `lib/workflow-read-model.js` (would unlock rule-8 age display).
- Live ticking age, click-through, animations — all listed Out of Scope in the spec.

## For the Next Feature in This Set

- N/A (no successor feature planned).

## Test Coverage

- `tests/integration/card-headline.test.js` — 26 cases covering all 11 precedence rules plus combinations (warn supersedes running, awaiting-input wins over running, idle ladder upgrades tone, age omitted when timestamp missing, lifecycle fallback). All pass.
- Existing `tests/integration/dashboard-state-render-meta.test.js` continues to pass (stateRenderMeta is still attached for agent-status spans).

## Planning Context

### ~/.claude/plans/foamy-foraging-blossom.md

# Card "Current Activity" Headline — Unified, State-Sensitive Banner

## Context

Today every kanban card surfaces its current activity as a tiny inline badge inside `.kcard-name` (e.g. `✍️ Addressing review`), driven by the lifecycle state's `STATE_RENDER_META.badge` string. The badge is the **least visible thing on the card** — smaller than the title and visually indistinguishable from metadata. Meanwhile the richest "what is happening right now" data (autonomous stage status, per-agent tmux state, idle ladder, awaiting-input, blockers, eval pick-winner, close failures) lives further down the card or isn't surfaced at all.

The fix has two parts. **First**, give every card a single, prominent headline block that renders the same way across every variant — fleet, drive, dormant, all lanes, feature/research/feedback, recurring, pre-engine, drifted. **Second**, drive that headline from a single server-side computation that selects the most informative signal available for each card by clear precedence rules, with a state-sensitive verb (RUNNING / WAITING / NEEDS YOU / BLOCKED / READY / DONE). The headline replaces the inline `kcard-state-badge`; spec-drift, scheduled-clock, blocked-by chains, and existing per-agent sections remain unchanged.

## The unified contract

Server attaches `feature.cardHeadline` to every entity row in `dashboard-status-collector.js`. Shape:

```js
{
  tone:    'running' | 'waiting' | 'attention' | 'blocked' | 'warn' | 'ready' | 'done' | 'idle',
  glyph:   '▶' | '◐' | '⚠' | '✓' | '○',
  verb:    'RUNNING' | 'WAITING' | 'NEEDS YOU' | 'BLOCKED' | 'READY TO CLOSE' | 'DONE' |
           'READY TO START' | 'NEEDS PRIORITISATION' | 'NEEDS TRIAGE' | 'PICK WINNER' |
           'CONFIRM <SIGNAL>' | 'CLOSE FAILED' | 'REBASE NEEDED' | 'SPEC DRIFT' |
           'NO ENGINE STATE' | 'IDLE' | 'FINISHED (UNCONFIRMED)',
  subject: string | null,   // e.g. 'Implement', 'Revision', 'Review', 'Eval'
  owner:   string | null,   // agent id ('CC') or 'you' or null
  age:     number | null,   // seconds since current state began; null if unknown
  detail:  string | null,   // optional sub-line — message, reason, "step 3 of 4", etc.
}
```

Render is one banner block under the title, full-width, with a 4px coloured left rail keyed by `tone`. Top line: `{glyph} {VERB}`. Second line: `{subject} · {owner} · {age}`. Optional third line: `{detail}`. Missing fields are gracefully omitted.

## Precedence — single function, first match wins

`computeCardHeadline(entity, snapshot, agents, autonomousPlan, lane)` walks the rules in order. This function is the **only** place that decides what a card says.

1. **Warn-class** (always supersedes):
   - `feature.lastCloseFailure` → `warn / ⚠ / CLOSE FAILED` · detail = reason · age = since failure
   - `feature.rebaseNeeded` → `warn / ⚠ / REBASE NEEDED`
   - `feature.specDrift` → `warn / ⚠ / SPEC DRIFT` · detail = "use Reconcile"
   - `currentSpecState === 'close_recovery_in_progress'` → `warn / ⚠ / RECOVERING CLOSE`
   - lane > backlog with no engine snapshot (F294 missing-snapshot post-backlog) → `warn / ⚠ / NO ENGINE STATE` · detail = "run aigon doctor --fix"

2. **Lane-terminal:** `done` → `done / ✓ / DONE` · age = closedAt; feedback `wont-fix` → `done / ✓ / WON'T FIX`.

3. **Awaiting human input:** any agent has `awaitingInput.message` → `attention / ◐ / NEEDS YOU` · owner = agentId · detail = message.

4. **Pending manual confirmation:** any agent has `pendingCompletionSignal` and `!isWorking` → `attention / ◐ / CONFIRM <SIGNAL>` · owner = agentId · detail = "Mark X complete".

5. **Eval pick-winner:** `feature.evalStatus === 'pick winner'` → `attention / ◐ / PICK WINNER` · detail = winner recommendation if any.

6. **Lane = inbox:** feature/research → `idle / ○ / NEEDS PRIORITISATION`; feedback → `idle / ○ / NEEDS TRIAGE`.

7. **Lane = backlog:** `blockedBy.length > 0` → `blocked / ⚠ / BLOCKED` · detail = "waiting on #N, #M"; else → `idle / ○ / READY TO START`.

8. **Lane = in-progress, autonomous (has stages):**
   - first stage with `status === 'running'` → `running / ▶ / {STAGE.LABEL}` · owner = stage.agents[0] · age = stage.startedAt
   - else first stage with `status === 'failed'` → `warn / ⚠ / {STAGE.LABEL} FAILED`
   - else first stage with `status === 'waiting'` and prior stage complete (a real gate) → `waiting / ◐ / {STAGE.LABEL} GATE` · owner = stage.agents[0]
   - else all stages complete → `ready / ✓ / READY TO CLOSE`

9. **Lane = in-progress, drive/solo (single agent):** map `agent.status` to verb/subject (implementing/reviewing/spec-reviewing → `running / ▶`; submitted → `attention / ◐ / SUBMITTED · "awaiting review"`; review-complete → `attention / ◐ / REVIEW DONE · "apply or reject"`; revision-complete → `attention / ◐ / REVISION DONE`); then layer:
   - `flags.sessionEnded` while `status==='implementing'` → `attention / ◐ / FINISHED (UNCONFIRMED)` · detail = "confirm to proceed"
   - `idleLadder.state === 'needs-attention'` → upgrade tone to `attention`, append "agent silent" detail
   - `idleLadder.state === 'idle'` (not running) → `waiting / ◐ / IDLE` · age = idleSec

10. **Lane = in-evaluation (research):** same shape as rule 8 against research stages.

11. **Fallback:** existing `STATE_RENDER_META` lifecycle entry → tone derived from `cls`, verb = uppercased label.

Every variant in §"Variant coverage" below routes through exactly one of these rules. Age and owner are best-effort: when timestamps are unavailable the headline drops them, never fabricates.

### Tone → colour mapping (reuse existing palette tokens)

| tone       | left-rail colour    | glyph |
|------------|---------------------|-------|
| running    | green (status-running)     | ▶ |
| waiting    | amber (status-reviewing)   | ◐ |
| attention  | amber bold + bg tint       | ◐ |
| blocked    | red (status-blocked)       | ⚠ |
| warn       | red bold + bg tint         | ⚠ |
| ready      | blue (status-review-done)  | ✓ |
| done       | neutral grey               | ✓ |
| idle       | grey                       | ○ |

## Variant coverage — proof every card is serviced the same

| Variant                                | Lane             | Rule |
|----------------------------------------|------------------|------|
| feature inbox (slug or numeric)        | inbox            | 6    |
| feature backlog ready                  | backlog          | 7    |
| feature backlog blocked by deps        | backlog          | 7    |
| feature autonomous running             | in-progress      | 8    |
| feature autonomous waiting at gate     | in-progress      | 8    |
| feature autonomous failed stage        | in-progress      | 8 (warn sub-rule) |
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
| feedback triaged / actionable          | triaged/actionable | 11 (lifecycle fallback) |
| feedback won't-fix                     | won't-fix        | 2    |
| recurring feature (server-created)     | normal lanes     | same as feature |
| missing-snapshot row in inbox/backlog  | inbox/backlog    | 6/7  |
| missing-snapshot row past backlog      | any              | 1    |

## Files to modify

- **NEW** `lib/card-headline.js` — pure function `computeCardHeadline(entity, snapshot, agents, autonomousPlan, lane)` returning the tuple. No I/O, no side effects.
- `lib/dashboard-status-collector.js` (~line 892, where `stateRenderMeta` is set) — also assign `entity.cardHeadline = computeCardHeadline(...)`. Keep `stateRenderMeta` populated (still consumed elsewhere — agent-status spans). Pass autonomous plan + agents that the collector already builds.
- `lib/state-render-meta.js` — unchanged structurally; the new headline computer reads it for rule 11 fallback.
- `templates/dashboard/js/utils.js` (~line 93) — add `buildCardHeadlineHtml(item)` returning the banner block; keep `buildStateRenderBadgeHtml` exported only for transitional fallback (delete callers).
- `templates/dashboard/js/pipeline.js` (line 838 in `buildKanbanCard`) — replace the inline `+ buildStateRenderBadgeHtml(feature)` call with a new full-width block rendered **after** `.kcard-name` and **before** `blockedByHtml` / `autonomousPlanHtml`. Apply to all three layout branches (fleet `hasAgentSections` line 843, drive `isSoloDriveBranch` line 911, dormant legacy line 941) — single insertion point above the branch fork keeps it consistent.
- `templates/dashboard/css/pipeline.css` (or wherever `.kcard-state-badge` CSS lives — discoverable via grep) — add `.kcard-headline` block + per-tone classes. Use `Skill(frontend-design)` to set the visual treatment.

## Tests

- **Unit** `tests/unit/card-headline.test.js` — one case per precedence rule plus key combinations (warn supersedes running, awaiting-input wins over running, idle ladder upgrades to attention, age omitted when timestamp missing, lifecycle fallback).
- **Integration** extend `lib/dashboard-status-collector.test.js` (or equivalent) to assert `cardHeadline` is attached to each row and matches expected tone for fixture lifecycle states.
- **E2E** extend existing specs in `tests/dashboard-e2e/`:
  - `solo-lifecycle.spec.js` — assert banner verb during implementing → submitted → review-complete.
  - `fleet-lifecycle.spec.js` — assert banner tracks autonomous stage transitions.
  - `failure-modes.spec.js` — assert warn banners for close-failure / rebase / drift.
  - `workflow-e2e.spec.js` — assert inbox/backlog/done banners and blocked-by rendering.
- **Visual** one `browser_snapshot` per lane after the change to confirm no regression elsewhere on the card.

## Implementation order

1. `aigon afc redesign-card-current-activity-headline` to land the spec in inbox; expand spec with this plan's contents.
2. Build `lib/card-headline.js` + unit tests; run `npm test` until green.
3. Wire into `lib/dashboard-status-collector.js`; `aigon server restart`; smoke-check with `browser_snapshot`.
4. Build `buildCardHeadlineHtml` in `templates/dashboard/js/utils.js`.
5. Insert into `templates/dashboard/js/pipeline.js buildKanbanCard` at one shared point above the three layout branches; remove inline `buildStateRenderBadgeHtml(feature)` call.
6. CSS via `Skill(frontend-design)`; iterate with `browser_snapshot` per lane until each variant reads cleanly.
7. Extend e2e specs.
8. Run iterate-loop gate: `npm run test:iterate`. Pre-push gate before commit: `npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh`.

## Verification

- For each row in the variant coverage table, open the dashboard at `http://localhost:4111` (or current port) and confirm the banner reads correctly. Use a seeded test repo (e.g. brewboard) to drive lifecycle transitions and confirm verb/owner/age update on poll.
- `mcp__playwright__browser_snapshot` after each lane to capture the a11y tree; confirm headline block appears once per card and the inline badge is gone.
- E2E specs above must pass; budget script must not regress.

## Out of scope (follow-ups, not v1)

- Live ticking age (banner inherits poll cadence).
- Click-through from banner to detail panel.
- Per-user customisation of which signal to surface.
- Animating tone transitions.
- Updating the `aigon` CLI's text views (e.g. `feature-list`) to use the same headline — separate feature if desired.

## Open assumptions worth flagging at review time

- `stage.startedAt` and `agent.statusChangedAt` may not exist on every snapshot today; the implementer should grep `lib/workflow-core/` and `lib/dashboard-status-collector.js` first and either reuse existing timestamps or add them to the snapshot. If unavailable, age silently drops — the banner stays informative without it.
- A "waiting at gate" sub-state (rule 8 third bullet) only fires when the previous stage is complete AND the current is `waiting`. If the engine doesn't currently distinguish "waiting because upstream isn't done" from "waiting because a human must act", treat all `waiting` stages as queue-style waiting (no separate verb) and rely on rule 3/4 to flag human-needed cards. Confirm during implementation.
