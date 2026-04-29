---
complexity: medium
set: signal-health
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-29T05:03:43.535Z", actor: "cli/feature-prioritise" }
  - { from: "inbox", to: "backlog", at: "2026-04-29T04:59:24.034Z", actor: "cli/feature-prioritise" }
---

# Feature: auto-nudge-with-visible-idle

## Summary

When an agent goes idle mid-task — paused at a permission prompt, sitting on a quota-cap choice screen, or just stuck — the workflow stalls silently until the user notices. Today, idle detection exists per-agent (`idleDetection.idlePattern` in each `templates/agents/<id>.json`) but nothing surfaces it visibly and nothing acts on it. This feature adds a three-tier idle ladder: a visible "💤 idle" chip on the dashboard at T1, a single auto-nudge at T2 (using the existing `lib/nudge.js` send-keys path), and an escalation to a red "🚨 needs attention" chip plus optional push notification at T3. Auto-nudge is **off by default** behind `.aigon/config.json → autoNudge.enabled` until `signal-health-telemetry` data shows nudges actually help more than they harm.

This is the second feature in the `signal-health` set; it consumes the data the foundation feature writes.

## User Stories

- [ ] As an Aigon operator, I want to see at a glance which agents on the dashboard are idle, so I can decide whether to intervene without attaching to each tmux session in turn.
- [ ] As an Aigon operator running an autonomous fleet overnight, I want one stuck agent to get auto-nudged once before escalating to "needs attention" — so a transient stall self-heals without me having to wake up.
- [ ] As an Aigon operator, I want auto-nudge off by default and individually toggleable per agent, so a known-flaky agent (e.g. one prone to permission prompts where nudging causes harm) doesn't get auto-nudged.
- [ ] As the Aigon developer, I want every nudge fired and every signal-recovery-after-nudge logged via `signal-health-telemetry`, so I can answer *"did auto-nudge actually help?"* with data, not vibes.

## Acceptance Criteria

- [ ] Three configurable thresholds per agent, in `.aigon/config.json → autoNudge`: `idleVisibleSec` (T1, default 60), `idleAutoNudgeSec` (T2, default 180), `idleEscalateSec` (T3, default 300). Per-agent overrides via `autoNudge.perAgent.<id>.{...}`.
- [ ] At T1, the dashboard agent tile renders an amber "💤 idle Ns" chip; the heartbeat row dims; no action is taken.
- [ ] At T2, if `autoNudge.enabled === true` AND `autoNudge.perAgent.<id>.enabled !== false`, exactly **one** nudge fires per (entity, agent) per session via the existing `lib/nudge.js` path. The nudge is logged as a `signal-recovered-via-nudge`-candidate event regardless of outcome (we measure success rate later).
- [ ] At T3, the tile flips to red "🚨 needs attention Ns"; a push notification fires if `pushNotifications.enabled === true`; no further auto-nudge is attempted (manual intervention required).
- [ ] Auto-nudge is **off by default** in the shipped config (`autoNudge.enabled: false`). The dashboard visible-idle chips are **on by default** — visibility is safe; action is not.
- [ ] If a `quota-paused` signal exists for the agent (from `feature-handle-quota-failure`), idle detection skips T2/T3 entirely — quota is not solved by nudging.
- [ ] The dashboard has a per-agent kebab menu item "Pause auto-nudge for this session" so the operator can disable nudges live without editing config.
- [ ] All idle transitions, nudge dispatches, and escalations are recorded as `signal-health-telemetry` events with kind `signal-recovered-via-nudge` (success), `signal-abandoned` (T3 reached without recovery), or `signal-emitted` (signal arrived independently of nudge).
- [ ] Integration test: scripted idle scenario where a fake agent doesn't write status; verify T1 chip appears at 60s, nudge fires at 180s, T3 chip appears at 300s. Run with `MOCK_DELAY=fast` so the test takes < 5s.

## Validation

```bash
node --check lib/auto-nudge.js
node --check lib/nudge.js
node --check lib/dashboard-status-collector.js
npm test -- --testPathPattern='(auto-nudge|idle|nudge)'
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.
- May tune the default thresholds (60/180/300) before merge based on whatever `signal-health-telemetry` shows about realistic idle durations in this repo.

## Technical Approach

### One module, three thresholds

`lib/auto-nudge.js` — single new module that the dashboard-status-collector poll loop calls every 5s. For each active agent, computes `idleSec = now - lastPaneActivityAt`, then maps to a state:

```
idleSec < T1                 → state: 'active'         (no chip)
T1 ≤ idleSec < T2            → state: 'idle-visible'   (amber chip, no action)
T2 ≤ idleSec < T3 + nudged   → state: 'idle-nudged'   (amber chip, nudge already sent)
T3 ≤ idleSec                 → state: 'needs-attention' (red chip, escalation done)
```

State is held in memory per (entity, agent, sessionStartedAt) — no persistence. Resets when the session restarts.

### What "idle" actually means

Two signals, ANDed: (a) the existing `idleDetection.idlePattern` matches the latest pane capture, AND (b) no `agent-status` write has happened in the last `idleVisibleSec` seconds. Either alone is too weak — pane-pattern can match while the agent is genuinely thinking; status-write timing alone misses agents that go silent without writing status.

### Why exactly one nudge

Two reasons. First, repeated nudging on a genuinely stuck agent (quota cap, permission prompt) just spams the pane and can change which choice gets selected by accident. Second, we want clean signal-health data — *"one nudge fired; did the signal arrive in the next 60 seconds?"* gives a clean attribution. Multiple nudges muddy that.

### Hooking into the existing stack

- `lib/nudge.js` already exists and handles tmux send-keys safely. Reuse it; this feature just adds a caller.
- `lib/dashboard-status-collector.js` already polls every 5s for status freshness. Add the idle-state computation in the same pass.
- `templates/dashboard/index.html` agent tile component grows two new chip states (`idle-visible`, `needs-attention`) — frontend-only addition.
- No new agent-status values; idle is a *display* state, not a *workflow* state. The engine doesn't care.

### Per-agent opt-out

A flaky agent (e.g. one that opens permission prompts mid-run, where a nudge would press the wrong button) can have `autoNudge.perAgent.cu.enabled: false` — the visible chip still renders, the nudge is suppressed. Live toggle on the dashboard for the same effect mid-session.

### Why off by default

Per `feedback_validate_with_real_tools_first.md`: shipping behaviour-changing automation without empirical evidence is a way to break working flows. Visible idle chips alone are pure information — they ship on. Nudge dispatch needs `signal-health-telemetry` data showing nudge → signal-arrived correlation before it flips to on by default. That decision happens in a follow-up after ≥ 30 days of telemetry, not in this feature.

## Dependencies

depends_on: signal-health-telemetry

## Out of Scope

- A general "agent watchdog" that handles all failure modes (quota, OOM, permission, idle, …). Quota has its own feature; OOM is provider-territory; permission prompts are a UX issue. Scope here: idle only.
- Cross-agent coordination ("if cc is idle, nudge cu instead"). The whole point of the visible chip is to surface decisions to the user, not to invent them.
- Email or SMS escalation. Push notifications via the existing `lib/push-notifications.js` only.
- Self-tuning thresholds (auto-adjust `idleAutoNudgeSec` based on observed p90). Could be a follow-up; first land static defaults.

## Open Questions

- Is there an existing per-agent "needs-attention" state in the dashboard that we should reuse instead of inventing a new chip class? Quick audit of `templates/dashboard/index.html` and `lib/state-render-meta.js` before implementation.
- Push-notification config — does that already exist or does this feature have to ship the plumbing? If the latter, push-notification is its own feature and we should defer T3-push to a follow-up.
- What's the right default for `idleEscalateSec`? 300s is a guess; might be too aggressive for `aigon-eval` long-running runs. May need per-task-type defaults (review-tasks tolerate longer idle than implementing-tasks).

## Related

- Set: signal-health
- Prior features in set: signal-health-telemetry
- Adjacent: feature-handle-quota-failure (quota-paused agents skip the idle ladder; the two features compose).
