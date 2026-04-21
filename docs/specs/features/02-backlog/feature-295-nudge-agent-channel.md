# Feature: nudge-agent-channel

## Summary
Operators (and eventually other agents) need a first-class way to send a text message into a running agent session — to redirect, classify a stall, pre-authorise a deviation, or hand off context mid-run. Today this is done by hand-assembling `tmux send-keys -t <long-session-name> "text" Enter` from a shell or a sibling agent. That path is fragile on three axes: **delivery** (multi-line / quote-heavy text can byte-interleave, same class of bug fixed in `d471d213` for feature-start), **visibility** (the operator can't confirm the nudge landed without tmux-peeking), and **auditability** (nothing records *what* was said to the agent or *when*, so post-run behaviour is hard to reconstruct).

This feature introduces `aigon nudge <ID> [agent] "message"` as the first-class primitive. It resolves the session name from engine state, delivers the text atomically via paste-buffer (same atomicity pattern as `bash -lc`), confirms delivery by reading back the pane, records the nudge as an engine event for audit, and handles the agent-specific submit-key via the agent registry. The dashboard's "awaiting input" affordance (F293) becomes a one-click Nudge modal that uses the same primitive.

Secondary unlock: once the primitive exists, **agent-to-agent messaging** is one exposure away. An implementer can nudge a reviewer, a conductor can nudge a stalled worker, F293's idle detector can suggest context-appropriate nudges. The current pain point ("did my nudge land?") is a specific symptom of a missing platform capability.

## Desired Outcome
A nudge is **as reliable and auditable as any other Aigon CLI operation**. The operator types one command with a short entity ID and a message, sees confirmation that it landed in the target pane, and can later see the nudge on the dashboard card and in the engine event log. Nothing about nudging requires knowing tmux session names, escaping shell quotes, or verifying by hand that the send-keys invocation actually hit the target.

Zero "did my nudge work?" questions. Zero byte-interleaved nudges. Every nudge accountable in the event log.

## User Stories
- [ ] As an operator, when cc stalls on a policy gate, I run `aigon nudge 294 cc "proceed with option A"` and get confirmation that the message landed — no tmux-peeking, no session-name guessing.
- [ ] As an operator reviewing what happened on a closed feature, `aigon feature-status 294 --json` (or the event log) shows me every nudge I sent with timestamp and text, so I can reconstruct why the agent took unusual actions.
- [ ] As an operator with a long message, newlines and quotes inside the nudge text don't corrupt the delivery — paste-buffer is atomic.
- [ ] As an operator via dashboard, I see a "Nudge..." button on active cards (especially when F293's idle badge fires) that opens a small modal and dispatches the nudge without me touching a terminal.
- [ ] As a future conductor / reviewer agent, I can call `aigon nudge <target-id> <target-agent> "..."` to pass context to a peer without constructing tmux commands or depending on transport details.
- [ ] As the eventual Phase-2 implementer of "auto-pilot with learned nudges", the nudge event log is already the training substrate — every operator intervention is captured alongside the agent's response.

## Acceptance Criteria
- [ ] New CLI command: `aigon nudge <ID> [agent] "message" [--role=do|review|spec-review|auto]`. If `agent` is omitted and the entity has exactly one active agent session, the command infers it. If multiple agents are active (Fleet), the command errors with a list and requires explicit agent.
- [ ] Session-name resolution via `buildTmuxSessionName` (same path as every other spawn site); never constructed ad-hoc.
- [ ] Text delivery uses `tmux load-buffer -` (stdin) + `tmux paste-buffer -t <session>` instead of `send-keys`. Atomic — same pattern the launch fix used.
- [ ] Submit key resolved from `templates/agents/<id>.json` under a new optional `cli.submitKey` field (default `Enter`). After the paste, the command sends the submit key via `send-keys`. Agents without a CLI submit pattern (cu's composer behaves differently) are handled explicitly — either via a per-agent adapter or a clear "nudge not supported for <agent>" error. No silent no-ops.
- [ ] Delivery confirmation: after paste + submit, the command reads the last N lines of the target pane and verifies the message text appears in the capture. Reports `✅ Nudge delivered to <session>` on success, `❌ Nudge text not found in pane after delivery` on failure, with the tail of the pane for diagnosis.
- [ ] Engine event recorded: `operator.nudge_sent` with `{ agentId, role, text, atISO }`. Appears in `.aigon/workflows/features/<id>/events.jsonl` (or research equivalent). Survives reset only per the normal reset semantics.
- [ ] Projector surfaces nudges on the snapshot as a bounded ring buffer `snapshot.nudges: [{ agentId, text, atISO }]` (keep last ~20). Dashboard reads it for the card display.
- [ ] Dashboard: active-card "Nudge..." action (wired through the action registry per CLAUDE.md rule 8 — no ad-hoc frontend logic). Opens a modal with textarea + agent picker (pre-filled when only one candidate), posts to a new endpoint that calls the same helper the CLI uses.
- [ ] Dashboard card renders the last 1–3 nudges inline as small chips, with full history one click away. Helps correlate "why did the agent do that?" with operator intent.
- [ ] Rate limit: ≤10 nudges per minute per session. Above that, error with a hint. Protects against runaway loops in future agent-to-agent usage.
- [ ] New regression tests:
  - Text with embedded newlines, single-quotes, and double-quotes delivers verbatim (not byte-interleaved).
  - Fleet with multiple active agents errors when agent omitted, succeeds when agent specified.
  - Event is recorded and surfaced on snapshot.
  - Delivery-confirmation fail path (e.g., paste into a dead session) returns a non-zero exit and clear error message.
- [ ] `docs/architecture.md` Module Map gains an entry for the new `lib/nudge.js`. `docs/development_workflow.md` gains a short section: "when an agent is idle or stuck, prefer `aigon nudge` over hand-crafted tmux."
- [ ] CLAUDE.md / AGENTS.md Quick Facts references `aigon nudge` as the canonical way to interrupt a running agent.

## Validation
```bash
node -c lib/nudge.js
node -c lib/commands/misc.js
node -c lib/workflow-core/projector.js
node -c lib/workflow-core/engine.js
npm test
MOCK_DELAY=fast npm run test:ui
bash scripts/check-test-budget.sh
```

## Pre-authorised
- May raise `scripts/check-test-budget.sh` CEILING by up to +50 LOC if the nudge regression tests (multi-line/quote/interleaving) require it. Commit must cite this line in its footer.

## Technical Approach

### The three axes the current approach fails on
1. **Delivery reliability.** `tmux send-keys` types character-by-character into the target tty. Concurrent sends (e.g., two operators, operator + AutoConductor, operator + future conductor-agent) interleave — this is exactly the class of bug fixed in `d471d213` for feature-start's launch command. Nudges inherit the same fragility today.
2. **Delivery confirmation.** Send-keys returns success whether or not the text landed correctly. Operator has to `tmux capture-pane` to verify — manual, opaque, easily skipped.
3. **Auditability.** Nothing records what was said to the agent. If cc does something surprising after an operator nudge, reconstructing the context requires scrolling back through terminal history — assuming the pane is still alive.

### Atomic delivery via paste-buffer
Same mechanic as the `d471d213` launch fix. tmux's `load-buffer` + `paste-buffer` pair inserts the full text in one operation — no per-character typing, no race window. The sequence is:
```bash
echo -n "$TEXT" | tmux load-buffer -
tmux paste-buffer -t "$SESSION" -p
tmux send-keys -t "$SESSION" "$SUBMIT_KEY"
```
The paste is a single atomic insert; send-keys only delivers the one-character submit press, which is too short to race meaningfully.

### Delivery confirmation
After paste + submit, read back the pane tail with `tmux capture-pane -p -t <session> -S -40` and verify the nudge text appears. If not, the text hit the wrong pane or the agent's UI consumed it in an unexpected way — surface the error with the pane tail attached so the operator can diagnose.

### Engine event + projector
New event type `operator.nudge_sent`:
```json
{ "type": "operator.nudge_sent", "agentId": "cc", "role": "do", "text": "...", "at": "2026-04-21T..." }
```
Projector appends to `snapshot.nudges` (bounded ring buffer, e.g., last 20). Dashboard reads it the same way it reads agent statuses — no new endpoint topology.

### Submit-key per agent
Agent JSONs gain an optional `cli.submitKey`:
- cc: `Enter` (current default — works today)
- cx: `Enter` (same)
- gg: `Enter` (same)
- cu: **TBD** — Cursor's composer may not submit on Enter. Investigate at implementation time; if there's no clean submit, the CLI errors "nudge not supported for cu" until someone solves it. No silent no-ops.

### Dashboard integration
Follows CLAUDE.md rule 8 — action goes in the central action registry (`lib/feature-workflow-rules.js`), frontend renders the button from `validActions`. Modal posts to `POST /api/feature/:id/nudge` which calls the same `lib/nudge.js` helper the CLI uses. Single code path, two entry points.

### Pairs with F293 (idle detector)
F293 detects when an agent session is alive but has emitted no workflow progress for N minutes. The natural "what next" when the idle badge fires is *nudge the agent*. F293's dashboard badge can link directly to the nudge modal, pre-populated with a suggested message based on last known activity ("You've been idle 20m — are you stuck on anything?"). Not part of this feature, but a well-worn seam.

### Pairs with agent-to-agent messaging (future)
Once `nudge` exists as a primitive, an implementer agent that wants to ping a reviewer can call it. Doesn't need to know about tmux session names, shell escaping, or which submit key the target uses. Opens up patterns like "implementer stuck → pings conductor" without building bespoke plumbing.

## Dependencies
- **Soft: F293 (agent-idle-detector-and-spec-preauth)** — once F293's idle badge exists, the dashboard's "Nudge..." affordance becomes a natural pairing. Not blocking; this feature ships independently.
- No hard deps.

## Out of Scope
- Agent-to-agent messaging patterns themselves (conductor pings worker, implementer pings reviewer). The primitive is this feature; the patterns that use it are follow-ups.
- Structured nudges (JSON payloads, command protocols). This feature delivers plain text — humans or agents compose the message, the agent's own prompt understanding handles parsing.
- Persistent nudge conversations ("threaded context between nudges"). Each nudge is a one-shot text insertion.
- Notification channels beyond the dashboard (SMS/email/Slack for missed nudges). Out of scope — notifications belong to F293's scope.
- Nudge undo / redact. Engine events are append-only; if a nudge contained sensitive text, the operator handles that at the policy level (don't type secrets into nudges).
- Automatic "suggested nudge" content based on agent state. Useful but speculative; file as a follow-up after seeing a month of real nudge traffic.

## Open Questions
- `cu` submit-key handling — does Cursor's composer accept Enter, or does it need a specific key combo? (Implementation-time check; if unsupported, error clearly rather than silently fail.)
- Should nudges be rate-limited per-session or per-operator? (Lean: per-session. Keeps the primitive simple.)
- Should the nudge event include the operator identity? (Lean: yes — `git config user.email` as default, overrideable via CLI flag. Matters once agent-to-agent nudges exist so we can distinguish operator vs. agent senders.)
- Dashboard modal: inline chip display of the last N nudges vs. full history in a drawer? (Lean: last 3 inline, full in a drawer. Same pattern as agent status badges vs. full event log.)
- Does `nudge` work against a spec-review or eval session too, or only `do` sessions? (Lean: any role that has an active tmux session. `--role=auto` targets AutoConductor if an operator needs to poke the loop — niche but cheap to support.)

## Related
- Triggered by: 2026-04-21 observation mid-F294 run — operator sent a classification nudge to cc via `tmux send-keys`, delivered correctly but operator couldn't tell from outside that it had landed. Followed a session-long pattern of hand-crafted send-keys nudges with the same opacity.
- `d471d213` — launch-command atomicity fix; same `send-keys → paste-buffer` transition this feature applies to nudges.
- F293 (`agent-idle-detector-and-spec-preauth`) — pairs naturally; idle badge links to nudge modal.
- CLAUDE.md rule 8 — actions defined centrally, frontend renders from `validActions`. This feature follows that rule for the dashboard Nudge button.
- CLAUDE.md Write-Path Contract — nudge introduces a new write path (`operator.nudge_sent` events); read paths are the dashboard card rendering and the event log.
