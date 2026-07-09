# Pause semantics (F656)

Aigon overloads “pause” across several independent mechanisms. This doc is the maintainer contract; runtime labels and CLI hints are derived from `lib/pause-semantics.js` (`PAUSE_SIGNALS`).

## Operator park (`currentSpecState: paused`)

**Meaning:** The operator intentionally parked work — either before start (`pauseReason: prestart:inbox|backlog`) or by interrupting implementation.

**Recovery:** `aigon feature-resume` / `aigon research-resume` (or dashboard **Resume**).

**Not this:** Quota blocks and automation failures keep the workflow in an active lifecycle; they surface on agent rows, `feature-*-auto.json`, or set conductor state instead.

| Signal | Dashboard label | Valid actions |
|--------|-----------------|---------------|
| `paused` + `prestart:inbox` | Parked (inbox) | `feature-resume` → inbox |
| `paused` + `prestart:backlog` | Parked (backlog) | `feature-resume` → backlog |
| `paused` + `startup_failed` | Parked (start failed) | `feature-resume` |
| `paused` (mid-run) | Parked | `feature-resume` → in-progress |

## Quota wait

**Meaning:** A provider rate limit blocked an agent or automation step.

| Signal | Dashboard headline / label | Recovery |
|--------|---------------------------|----------|
| Agent `status: quota-paused` | Quota paused (agent row) / Quota waiting (headline) | `agent-resume` when probe allows; optional `drop-agent` |
| `feature-*-auto` `status: quota-paused` | Quota waiting | Wait or `feature-autonomous-resume` |
| `feature-*-auto` `reason: review-quota-paused` | Reviewer quota paused | Rerun review / `feature-autonomous-resume` |
| Set `status: paused-on-quota` | Set paused (quota) | `set-autonomous-resume` (choose agents) |

## Automation stopped

**Meaning:** AutoConductor or SetConductor halted on a failure, checkpoint, or user stop — not operator park.

| Signal | Dashboard headline | Recovery |
|--------|-------------------|----------|
| `feature-*-auto` `status: stopped` + reason | Automation stopped (+ reason label) | `feature-autonomous-resume` / reason-specific actions |
| `feature-*-auto` `status: failed` | Autonomous failed | Recovery actions from `workflow-read-model` reason map |
| Set `status: paused-on-failure` | Set paused at member | `set-autonomous-resume` |

## CLI scope

`feature-pause` / `feature-resume` and `research-pause` / `research-resume` only park or unpark operator-held specs. They do **not** clear quota blocks or restart automation — those commands print scope hints on misuse.

## Related modules

- `lib/pause-semantics.js` — label/headline helpers + `PAUSE_SIGNALS` audit table
- `lib/state-render-meta.js` — base lifecycle badges; `paused` refined via `resolveStateRenderMeta`
- `lib/card-headline.js` — precedence: autonomous failure/stop/quota before generic lifecycle
- `lib/quota-dashboard-actions.js` — per-agent `agent-resume` when quota-paused
- `lib/set-conductor.js` — `paused-on-failure` / `paused-on-quota` set sidecar
- `lib/feature-autonomous.js` — AutoConductor `stopped` / `quota-paused` sidecar
