---
complexity: medium
set: signal-health
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-29T05:03:43.017Z", actor: "cli/feature-prioritise" }
  - { from: "inbox", to: "backlog", at: "2026-04-29T04:59:23.771Z", actor: "cli/feature-prioritise" }
---

# Feature: signal-health-telemetry

## Summary

Aigon's entire workflow depends on agents writing lifecycle status signals (`agent-status implementing`, `…-complete`, `…awaiting-input`, etc.). When an agent silently fails to signal — quota cap, model hiccup, prompt drift, or just a model that doesn't follow instructions reliably — the workflow stalls and only manual intervention recovers it. Today we have no durable record of *which* agents fail to signal, *how often*, or *under what conditions*. This feature lays down the data layer: every signal write, every missed-signal recovery, every nudge, every quota pause, every timeout gets logged to `.aigon/telemetry/signal-health/` with enough context to answer the per-installation question *"is this agent reliably signalling for the kind of work I run through Aigon?"*

This is the foundational feature in the `signal-health` set — `auto-nudge-with-visible-idle` and `aigon-eval` both consume the data this writes.

## User Stories

- [ ] As an Aigon operator, I want to ask *"how reliable is gg in this repo over the last 30 days?"* and get a real answer (e.g. *"gg signalled correctly 8/12 times; 4 sessions required user intervention"*) so I can decide whether to keep using it.
- [ ] As an Aigon operator, I want to see the *reason* a signal was missed (quota, idle, exit-without-signal, prompt-drift) so I can fix the root cause instead of switching agents reactively.
- [ ] As the Aigon developer, I want signal-health data to be the input both `auto-nudge-with-visible-idle` (to set thresholds) and `aigon-eval` (to score pass/fail) consume — one source of truth, not three.
- [ ] As an Aigon operator running an autonomous fleet, I want a single dashboard panel showing *agent signal reliability* alongside the existing cost/turn telemetry so I see the full operational picture.

## Acceptance Criteria

- [ ] New module `lib/signal-health.js` with two public functions: `recordSignalEvent({ agent, entityType, entityId, kind, ... })` and `readSignalEvents({ since, agent?, kind? })`. Schema is JSON-Lines under `.aigon/telemetry/signal-health/<YYYY-MM-DD>.jsonl` (one file per UTC day, append-only).
- [ ] Event kinds covered (extensible enum): `signal-emitted` (status write happened on time), `signal-missed` (expected status by deadline T, none arrived), `signal-recovered-via-nudge` (nudge fired, signal arrived after), `signal-recovered-via-user` (user manually wrote agent-status), `signal-abandoned` (no recovery within max-wait, session killed or timed out), `signal-out-of-order` (an unexpected status preceded the expected one).
- [ ] `lib/agent-status.js` `writeAgentStatus` and `writeAgentStatusAt` call `recordSignalEvent({ kind: 'signal-emitted', ... })` on every successful write — no engine-state coupling, just observation.
- [ ] `lib/nudge.js` calls `recordSignalEvent({ kind: 'signal-recovered-via-nudge', ... })` after a successful nudge dispatch where the previously-expected signal then arrives.
- [ ] New CLI: `aigon signal-health [--agent <id>] [--since <date>] [--entity-type feature|research] [--json]`. Default output: per-agent counts and reliability percentage over the last 30 days. `--json` for machine consumption.
- [ ] New `aigon doctor` section: *Signal-health summary (last 30 days)* with the same per-agent table; warns when reliability for any agent is < 70% over ≥ 5 sessions.
- [ ] Dashboard panel: optional, deferred to a follow-up — but the API endpoint `/api/signal-health` ships in this feature so the panel is a thin frontend addition later.
- [ ] Append-only writes use the same atomic pattern as `agent-status` (write tmp, rename) — no partial reads, no lock files needed for single-writer-per-event semantics.
- [ ] Old daily files older than `signalHealthRetentionDays` (config, default 90) are deleted by `aigon doctor --gc` — not mid-write, not on every read. Bounded disk footprint.
- [ ] All event writes are non-blocking and never throw to the caller; a failure to log is logged to stderr and the workflow proceeds. Telemetry must never break the workflow.
- [ ] Integration test: spawn a mock agent session, verify the event log shows `signal-emitted` for each transition; suppress the final signal, verify `signal-missed` is recorded.

## Validation

```bash
node --check lib/signal-health.js
node --check lib/agent-status.js
node --check lib/nudge.js
node --check lib/commands/signal-health.js
npm test -- --testPathPattern='(signal-health|agent-status)'
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Technical Approach

The minimum-viable shape is deliberately tiny: one writer module, JSONL files, one reader CLI, one doctor section. No new database, no new event bus, no new schema migration.

### Storage

`.aigon/telemetry/signal-health/<YYYY-MM-DD>.jsonl` — one event per line. Each line:

```json
{"t":"2026-04-29T10:14:03Z","agent":"gg","entityType":"research","entityId":"45","kind":"signal-missed","expected":"research-complete","lastStatus":"implementing","lastStatusAt":"2026-04-29T10:11:40Z","elapsedSec":143,"sessionName":"aigon-r45-do-gg-..."}
```

Daily file rotation is the right granularity: easy to gc, easy to grep, no schema-evolution headaches.

### What detects "missed"

A poll loop in the existing dashboard-status-collector cadence (5s) compares each active agent's last-status-write timestamp against per-status SLAs from config:

- `implementing` → expected to advance (any other status) within `implementingMaxIdleSec` (default 600s)
- `reviewing` → `reviewingMaxIdleSec` (default 600s)
- (etc., per-status table)

When SLA breached and no recovery, write `signal-missed`. When recovery follows, write `signal-recovered-via-{nudge|user}`. Don't double-count: each (entity, agent, expected-signal) tuple gets at most one `signal-missed` event per session.

### Why JSONL not SQLite/structured

JSONL is append-only, crash-safe (partial last line is recoverable), and trivially greppable. SQLite would be overkill for tens of events per session and would introduce a write lock that conflicts with the multi-writer-per-repo case (multiple agents emitting status in parallel). JSONL with daily rotation handles this cleanly.

### Integration points (minimal surface)

- `lib/agent-status.js`: 2 lines — call `recordSignalEvent('signal-emitted', ...)` after each successful write.
- `lib/nudge.js`: 3 lines — call `recordSignalEvent('signal-recovered-via-nudge', ...)` after the nudged signal arrives.
- `lib/dashboard-status-collector.js`: ~20 lines — the SLA-poll loop that emits `signal-missed`.
- `lib/doctor.js`: ~30 lines — read events, render per-agent summary, warn on threshold.
- `lib/commands/signal-health.js`: new file, ~80 lines — CLI command.
- `templates/generic/commands/signal-health.md`: thin slash-command wrapper for agent invocation.

Total new code: under 200 lines. No engine changes. No template changes for existing commands.

### Why this lands first in the set

`auto-nudge-with-visible-idle` needs the `signal-missed` events to know when to nudge and the `signal-recovered-via-nudge` events to know if its nudges actually help. `aigon-eval` needs the same data to score pass/fail per model. Building either of those before the telemetry exists means measuring on shaky ground.

## Dependencies

depends_on: none

## Out of Scope

- Cross-installation aggregation (would be a Pro feature; design the schema so it composes, but ship per-repo only here).
- A signal-health dashboard widget — add the API endpoint, defer the UI.
- Automatic remediation (that's `auto-nudge-with-visible-idle`).
- Model-quality eval (that's `aigon-eval`).
- Anonymisation / sanitisation for sharing across users — the data is per-installation, never leaves the repo.

## Open Questions

- What's the right default for `implementingMaxIdleSec`? 600s is a guess; need to look at p50/p90 of real implementing sessions in this repo's existing telemetry to calibrate.
- Should `signal-emitted` events be sampled (every Nth) at high volume, or always logged? Initial decision: always log; revisit if volume becomes a problem.
- Do we backfill from existing `.aigon/state/feature-*-<agent>.json` write timestamps? Probably yes — one-time backfill in `aigon doctor --backfill-signal-health` so the first dashboard view isn't empty.

## Related

- Set: signal-health
- Prior features in set: (none — this is the foundation)
- Triggered by: 2026-04-28 incident (research 45 cc/cu/gg silent stalls); see commit `bfd5047b` for the immediate fix and the full audit.
- Adjacent: feature-handle-quota-failure (orthogonal — that handles quota specifically; this records the signal events that include quota events as one cause among several).
