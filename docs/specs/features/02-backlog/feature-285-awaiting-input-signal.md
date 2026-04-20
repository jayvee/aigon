# Feature: awaiting-input-signal

## Summary
Agent sessions that reach a human-in-the-loop decision point (research-eval synthesis, feature-eval winner pick, feature-review ambiguity) currently sit silently at a prompt. The dashboard card shows the same lifecycle state (`evaluating`, `reviewing`) it showed while the agent was actively working, so there's no way to know it's your turn without attaching to the tmux session. This adds a **generic, per-agent `awaiting-input` signal**: agents emit `aigon agent-status awaiting-input "<question>"` when they block on user input, the dashboard renders a pulsing badge with the question on the card, and the supervisor fires a desktop notification. The signal auto-clears when the agent emits any subsequent status (submitted, review-complete, error) or when its tmux session dies. Generic on purpose — the caller supplies the message, so the same plumbing serves research-eval today, feature-eval and feature-review tomorrow.

## User Stories
- [ ] As a user whose research eval agent has finished synthesising and is waiting for me to pick features, I get a desktop notification and see a clear "awaiting your input" badge on the card — without having to attach to the tmux session.
- [ ] As a user glancing at the dashboard, I can tell at a glance which agents are working vs waiting on me, even though they share the same lifecycle state.
- [ ] As a template author writing a new agent flow that pauses for a human decision, I can emit this signal in one line (`aigon agent-status awaiting-input "..."`) without touching engine state or adding a new lifecycle phase.
- [ ] As a user who just replied to an agent in tmux, I don't need to manually clear any "waiting" flag — the badge disappears on the agent's next status write.

## Acceptance Criteria
- [ ] `aigon agent-status awaiting-input "<message>"` writes `{ awaitingInput: { message, at } }` to the per-agent state file via `lib/agent-status.js`. Atomic write. Exits 0.
- [ ] Calling it again overwrites the message+timestamp (for multi-turn pauses).
- [ ] Any subsequent `agent-status` write (`submitted`, `review-complete`, `error`, `reviewing`) clears `awaitingInput` in the same atomic write.
- [ ] When the tmux session for an agent disappears, `awaitingInput` is cleared on the next status poll (supervisor / reconciler path — whichever already owns stale-session cleanup).
- [ ] `lib/dashboard-status-collector.js` surfaces `awaitingInput` on both feature and research card payloads (per-agent field, plus a card-level `anyAwaitingInput: boolean` convenience).
- [ ] Dashboard renders a pulsing amber badge on the card when any agent has `awaitingInput` set; the badge tooltip / popover shows the message and a "Go to session" link that runs `aigon feature-open <id>` or `aigon research-open <id>`. `Skill(frontend-design)` MUST be invoked before editing `templates/dashboard/index.html`. Playwright screenshot captured and attached.
- [ ] `lib/supervisor.js` fires a desktop notification on the absent→present transition only (not every poll). Reuses the existing notification helper.
- [ ] `templates/generic/commands/research-eval.md` calls the signal at the synthesis-pause point (Step 4 → 5 handoff) with the question shown to the user. Old "commit + tell user" flow is unchanged except for the new signal line before the pause.
- [ ] Per-agent test in `tests/` covering: write, overwrite, auto-clear on other status, stale-session clear.
- [ ] Dashboard payload test covering both `awaitingInput` per-agent field and `anyAwaitingInput` rollup.
- [ ] Test suite stays under 2000 LOC (CLAUDE.md Rule T3). If at ceiling, propose a deletion in the same commit.

## Validation
```bash
node -c aigon-cli.js
npm test
MOCK_DELAY=fast npm run test:ui
bash scripts/check-test-budget.sh
```

## Technical Approach

### Data shape
Per-agent state file (`.aigon/state/{prefix}-{id}-{agent}.json`) gains an optional field:

```json
{
  "awaitingInput": {
    "message": "Pick which of the 5 proposed features to create. Reply with the numbers.",
    "at": "2026-04-20T14:30:00.000Z"
  }
}
```

Absent when not blocked. Single field — no history. Overwriting is fine; users care about the current question, not the trail.

### Module ownership
- **`lib/agent-status.js`** — new `writeAwaitingInput(entityType, id, agentId, message)` and the clear-on-other-status logic goes in the existing atomic write path. ~30 lines.
- **`lib/commands/misc.js`** — existing `agent-status` handler gets a new sub-verb. ~20 lines.
- **`lib/dashboard-status-collector.js`** — read the field, attach to card payload. ~15 lines.
- **`lib/supervisor.js`** — in-memory map of last-known `awaitingInput` per agent; on transition absent→present, fire notification. ~20 lines.
- **`templates/dashboard/index.html`** — amber pulsing badge + tooltip. Frontend-design skill mandatory. ~50 lines.
- **`templates/generic/commands/research-eval.md`** — one line added before Step 4's wait-for-user. 1–2 lines.

### Signal, not state
`awaitingInput` is a **display-only flag**, written to the agent-status file. It does NOT touch the workflow engine, does NOT produce an event, does NOT change the XState machine. Same discipline as the heartbeat (CLAUDE.md: "Heartbeat is display-only"). This is the correct level for a UX hint — elevating it to a lifecycle state would couple prompt-patterns to engine state and that's the kind of coupling the write-path contract warns against.

### Clearing semantics
Three clears, in precedence order:
1. Explicit: any subsequent `agent-status` write (submitted/review-complete/error/reviewing) clears it in the same atomic write. Zero ceremony for template authors.
2. Implicit: stale-session reconciler (already exists in `lib/dashboard-status-helpers.js` / supervisor path) clears it when the tmux session is gone.
3. There is no "user dismissed" clear. If users click into the session and answer, the agent's next status write handles it. If they dismiss without answering, the question is still pending — don't hide it.

### Notification transition logic
Supervisor maintains `Map<agentKey, lastAwaitingInputAt>`. On each poll, compare current file state to map:
- absent → present: fire desktop notification with the message, update map.
- present → present (same timestamp): no-op.
- present → present (new timestamp): fire notification (new question, same agent).
- present → absent: clear map entry, no notification.

### Naming decision
`awaiting-input` over alternatives considered:
- `needs-input` — less neutral, feels demanding
- `question` — too narrow (could also be "review this and decide")
- `paused` — conflates with supervisor-detected stalls
- `blocked` — ambiguous (blocked on what?)

`awaiting-input` reads well as both a verb phrase in the CLI and a noun in the payload.

### Future generalisation (out of scope here, but informs the design)
Once this ships for research-eval, the same signal trivially covers:
- `feature-eval` fleet winner selection (eval template emits signal before showing the comparison table)
- `feature-review` when reviewer wants to confirm a change before applying (template emits signal with the proposed diff summary)
- Any `afd` / `ard` template that wants to pause for confirmation

None of those are in scope for *this* feature — they're template edits that follow naturally once the plumbing exists.

## Dependencies
-

## Out of Scope
- Workflow lifecycle state changes (no `awaiting-decision` phase; this is display-only)
- Two-way replies from the dashboard (user still answers in the tmux session; "reply from dashboard" is a separate, larger feature)
- Email / Slack / mobile push notifications (desktop only, reuses existing channel)
- Persistence across server restarts beyond what the per-agent state file already gives (supervisor's in-memory map rebuilds on start and will replay notifications for any currently-awaiting agents — acceptable)
- Template updates for `feature-eval` and `feature-review` (noted above as natural follow-ups; ship them after this lands and the pattern is proven)
- Audit log / history of past pauses (only the current question matters)

## Open Questions
- Should the dashboard "Go to session" button be a direct tmux attach command (requires terminal launch) or just a copy-to-clipboard of the command? Leaning copy-to-clipboard to avoid spawning terminals from a web UI. Defer to `frontend-design` during implementation.
- Does the pulsing badge need a sound in addition to the desktop notification? Probably no (user preference noted in memory: avoid over-signalling).
- Should stale-session cleanup fire a "question abandoned" notification, or silently clear? Leaning silent — the session is gone, no action the user can take.

## Related
- Research:
- Triggered by: research 34 eval UX gap (session idle at synthesis, no dashboard signal)
