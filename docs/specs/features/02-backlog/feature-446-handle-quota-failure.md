---
complexity: high
set: quota
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-29T05:03:43.795Z", actor: "cli/feature-prioritise" }
  - { from: "inbox", to: "backlog", at: "2026-04-29T04:59:17.810Z", actor: "cli/feature-prioritise" }
---

# Feature: handle-quota-failure

## Summary

`feature-agent-quota-awareness` covers the pre-flight case: probe periodically, refuse to start work that has no chance of running, grey out depleted (agent, model) pairs in the dashboard. This feature covers the orthogonal mid-run case: an agent that was *available* at session-start but hits its quota cap *during* a session — minute 7 of a 30-minute feature run, or one Fleet member depleting while the other two carry on. The 2026-04-28 r45-gg / r46-gg incidents are the canonical examples: Gemini Pro daily limit tripped after the agent had already started work, and the tmux session sat at the *"Switch to flash / Upgrade / Stop"* choice screen indefinitely with no signal back to Aigon.

This feature reuses the regex packs, data model, and probe primitives that `agent-quota-awareness` establishes; it does **not** redefine them. The new contribution is mid-run-only: detection during an active session, a per-agent `quota-paused` status signal, autopilot integration, and a resume path. It does not add a new feature/research `currentSpecState`; any entity-level pause is represented by the existing autopilot/run status plus per-agent status files. Second feature in the `quota` set; depends on the foundation.

## User Stories

- [ ] When my Gemini agent hits the daily Pro quota mid-feature, I want Aigon to notice within the next poll cycle, write `quota-paused` for that agent, and keep the rest of the workflow moving — not block the whole feature on me discovering it manually.
- [ ] When I'm running an autonomous feature overnight and one of three Fleet agents hits a quota cap, I want the surviving two to keep progressing and the dashboard to surface the capped one as a single tile needing attention, not stall the whole feature.
- [ ] When a code-review agent hits a quota cap mid-review, I want the implementation agent's wait loop to break gracefully (with a clear "review agent quota-paused" message) rather than wait forever for a `review-complete` signal that won't arrive.
- [ ] When quota resets at the documented reset time, I want a one-click resume that re-launches the paused session with full context (transcript, partial git state, prior pane buffer) intact — not a fresh start.

## Acceptance Criteria

### Detection (mid-run only — pre-flight is awareness's job)

- [ ] **Reuse `quota.errorPatterns[]` from `feature-agent-quota-awareness`** — this feature does not define its own patterns. The pre-flight probe and the mid-run detector consume the same regex pack from `templates/agents/<id>.json:quota.errorPatterns[]`.
- [ ] **New scope: pane buffer scanning during active sessions.** Awareness's probe sees stdout/stderr from a one-shot PONG call. This feature additionally scans the live tmux pane buffer of *running Aigon-managed agent sessions* every 5 seconds (re-using the existing `lib/dashboard-status-collector.js` poll cadence) for the same patterns. Quota messages frequently render in TUI choice boxes (e.g., Gemini's "Switch to flash / Upgrade / Stop") — pane scan is the only surface that catches this. Session targeting must use the session sidecar / `tmuxId` path where available, not parse tmux names.
- [ ] **Promote a pane-scan match to a workflow event** named `feature.agent_quota_paused` or `research.agent_quota_paused`. Payload carries `{ entityType, entityId, agentId, role, sessionName, tmuxId?, modelValue?, patternId, resetAt?, detectedAt, paneSampleHash }`. Store a hash/short debug excerpt only; do not persist full pane buffers into the event log.
- [ ] **Deduplicate detections.** Once an agent session has been marked `quota-paused` for a matched `(entity, agent, sessionName, patternId)`, later polls do not append duplicate workflow events or repeatedly rewrite `quota.json` unless the `resetAt` value changes.

### Lifecycle signal

- [ ] **New `quota-paused` agent-status value** in `lib/agent-status.js`, and added to `AWAITING_INPUT_CLEARED_BY` (the agent isn't waiting on the user, it's waiting on the provider clock). `lib/auto-nudge.js` already treats this status as a nudge-skip signal; keep that behaviour covered.
- [ ] **Per-agent signal, not a new entity lifecycle state.** `feature-workflow-rules.js` and `research-workflow-rules.js` do not gain a `quota_paused` `currentSpecState` in this feature. The entity stays in its existing lifecycle while other agents continue; if every live agent is quota-paused, the autonomous run exits with a durable run status of `quota-paused` and a clear resume action, without moving the spec folder.
- [ ] **Update `quota.json`** (the data file owned by awareness) when a mid-run detection fires — flip the (agent, model) pair to `verdict: "depleted"` so the next pre-flight check is consistent. Single source of truth, populated by both probe paths.

### Autopilot integration

- [ ] **`feature-autonomous.js` and `research-autopilot.js` treat `quota-paused` as a non-blocking terminal state per-agent.** Specifically:
      - **Fleet mode:** the gate "all agents have submitted" relaxes to "all agents have submitted OR are quota-paused". The eval/review proceeds with surviving agents. The capped agent is marked `dropped-from-run` in the engine event log, not failed.
      - **Solo mode:** finish the autopilot run with status `quota-paused`, surface to the user, do NOT loop. The user can resume after reset.
- [ ] **Mid-session waits break cleanly.** When `feature-autonomous.js` is waiting for a `review-complete` signal and the review agent goes `quota-paused`, the wait exits with a clear log line (`❌ Review agent quota-paused at <reset>; resume after quota lifts.`) rather than timing out generically.

### Resume

- [ ] **New CLI: `aigon agent-resume <id> <agent>`** (and dashboard "Resume" button calling the same path):
      - Reads the paused session's metadata sidecar (`.aigon/sessions/<sessionName>.json`).
      - Reconstructs the tmux launch command through `lib/agent-launch.js:buildAgentLaunchInvocation` and the existing worktree/session launch helpers, preserving saved `prompt + agent + worktree + model + effort`.
      - Writes status back to whatever the pre-quota status was (typically `implementing`).
      - Records a `feature.agent_quota_resumed` / `research.agent_quota_resumed` event for analytics.
- [ ] **Resume validates session ownership and state.** It refuses if the sidecar is missing, belongs to another entity/agent, has no resumable prompt/worktree, or the current status is not `quota-paused`; each refusal exits non-zero with a specific repair hint.
- [ ] **Resume refuses early if the (agent, model) pair is still depleted** per `quota.json`. Prints the next probe time and "Try `aigon agent-probe --quota <agent>` to check now" hint.

### Dashboard surface

- [ ] **Per-agent tile chip: `⏸ Quota — resets 13:43 [Resume] [Skip]`** when a session is `quota-paused`. Resets-at value comes from the awareness-shared `quota.json` (parsed at detection time via the shared `resetExtractor`).
- [ ] **"Skip" button**: drop the agent from this run permanently (writes `dropped-from-run`); used when the operator decides not to wait.

### Recovery policy (config, not behaviour)

- [ ] `.aigon/config.json → quotaPolicy` — three modes; ship `pause-and-wait` (current default) only; `fallback-model` and `fallback-agent` flagged as follow-ups gated on observed user demand. Implementation in this feature is `pause-and-wait`-only; the config field shape exists so the follow-ups are additive, not breaking.

### Tests

- [ ] **Integration test (mid-run detection):** mock provider that returns success at session-start, then emits a quota error to the pane buffer at minute 2; verify the detector writes `quota-paused`, appends one `*.agent_quota_paused` event with the expected payload, autopilot drops the agent, and `quota.json` flips to `depleted`.
- [ ] **Integration test (duplicate suppression):** leave the same quota message in the pane buffer across multiple collector polls; verify only one workflow event is appended and `quota.json` is not rewritten repeatedly.
- [ ] **Integration test (resume):** spin up a session, force `quota-paused`, simulate quota.json flipping back to `available`, run `aigon agent-resume`; verify the session reconstructs with the original prompt and worktree.
- [ ] **Integration test (resume refusal):** keep quota.json depleted and verify `aigon agent-resume` exits non-zero with the next-probe hint, without launching tmux or changing agent status.
- [ ] **Integration test (Fleet survival):** three-agent Fleet, force one to `quota-paused` mid-run, verify the other two complete and `feature-eval` is offered with the surviving two.

## Validation

```bash
node --check lib/quota-mid-run-detector.js
node --check lib/agent-status.js
node --check lib/feature-autonomous.js
node --check lib/commands/agent-resume.js
npm test -- --testPathPattern='(quota|agent-status|autonomous)'
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.
- May add the `quota-paused` lifecycle signal to `lib/agent-status.js` and the workflow-rules files as needed; this is the whole point of the feature.

## Technical Approach

### What this feature owns vs what awareness owns

| Concern | Owned by |
|---|---|
| Regex packs in `templates/agents/<id>.json:quota.errorPatterns[]` | awareness |
| `.aigon/state/quota.json` schema and writer | awareness |
| Cron/probe loop that polls every 5 min | awareness |
| Pre-flight `feature-start` gate | awareness |
| Dashboard greying of depleted entries in the picker | awareness |
| **Pane-buffer scan during active sessions** | **this feature** |
| **`quota-paused` lifecycle signal + status writes** | **this feature** |
| **Autopilot integration: drop-from-fleet, surviving-agent eval** | **this feature** |
| **`aigon agent-resume` CLI + dashboard button** | **this feature** |
| **`quota-paused` dashboard tile chip** | **this feature** |

### Single new module

`lib/quota-mid-run-detector.js` — runs in the existing dashboard-status-collector poll loop and receives active-session metadata from the collector, rather than reading workflow/spec files directly. For each active agent session:

1. Read the live tmux pane buffer via the existing pipe-pane capture (F430), addressed by `tmuxId` when present.
2. Match against `loadAgentConfig(agentId).quota.errorPatterns` (read from disk on each poll for hot-reloadability — patterns are JSON data, not code, per awareness's design).
3. On match: extract `resetAt` if present, write `quota-paused` agent-status with enough metadata to restore the previous status on resume, update `quota.json` through awareness's writer/lock convention, emit `*.agent_quota_paused`, and remember the detection key so the next poll is idempotent.

Total new code estimate: ~150 lines for the detector + ~80 lines for `agent-resume` CLI + autopilot edits = ~300 lines.

### Why this lands second in the set

The pane-buffer scan needs the same regex packs awareness ships, the same `quota.json` schema awareness defines, and the same `resetExtractor` interpretation logic awareness implements. Building this first would force decisions about regex pack location and `quota.json` shape that awareness should own as the foundation. Building it second is straightforward: import what awareness ships, layer mid-run-specific behaviour on top.

### Why not merge with awareness into one feature

Two reasons: (1) different blast radius — awareness touches `feature-start` and the dashboard picker, which are user-facing entry points; failure handling touches autopilot internals and the lifecycle state machine, which are workflow internals. Different surfaces, different reviewers, different test discipline. (2) Awareness is independently shippable and immediately useful (greying alone unblocks the `aigon-eval` and benchmark cases); failure handling builds on top once awareness is stable in the wild.

### Cross-set hook for `aigon-eval`

`aigon-eval` runs canned workloads against (agent, model) pairs. If a quota cap fires mid-eval, the bench shouldn't count that as a failure of the model's instruction-following — it's an external infrastructure event. The eval feature notes this as a soft dependency on awareness (skip pre-known-depleted pairs) and reads the `quota-paused` events this feature emits to classify mid-run quota events as `quota-skipped` rather than `failed`.

## Dependencies

depends_on: agent-quota-awareness

## Out of Scope

- Defining the regex packs themselves (owned by awareness).
- The `.aigon/state/quota.json` schema (owned by awareness).
- The cron probe loop (owned by awareness).
- Pre-flight gating in `feature-start` / `perf-bench` (owned by awareness).
- General "agent stuck" detection beyond quota — idle detection is `auto-nudge-with-visible-idle`'s territory.
- Auto-purchase / auto-upgrade of quota tiers. Even if technically possible, never trigger this automatically.
- Cross-provider quota arbitrage ("the cheapest agent right now is X, switch preemptively"). Recommender concern, not failure-handling concern.

## Open Questions

- Coordination on writes to `.aigon/state/quota.json` between awareness's cron probe and this feature's mid-run detector — single-writer-per-event-type, file lock, or atomic-rename per agent? Decide during awareness's implementation; this feature uses whichever convention awareness establishes.
- For `fallback-model` mode (deferred to follow-up): does the existing modelOptions array carry enough metadata to pick a sensible fallback automatically, or do we need explicit `fallbackModel` annotations? Probably need annotations — defer until the feature is requested.
- Should mid-run detection also consider the `quota-paused` event a signal for `signal-health-telemetry`? The capped agent didn't fail to follow instructions — it ran out of provider quota. Probably classify as `signal-recovered-via-quota-pause` (a separate telemetry kind) rather than `signal-abandoned`. Decide once telemetry's event taxonomy is finalised.

## Related

- Set: quota
- Prior features in set: agent-quota-awareness
- Triggered by: 2026-04-28 incident (research 45 gg, research 46 gg both stalled on quota choice screens). Investigation captured in commit `bfd5047b`'s message and the conversation history that produced it.
- Cross-set: feature-aigon-eval — should classify mid-run quota events as `quota-skipped`, not as a model failure. Reads `*.agent_quota_paused` events this feature emits.
- Memory pointer: `feedback_quarantine_bad_models.md` — quota and quarantine are complementary; quota is "this agent is fine, just throttled right now"; quarantine is "this agent is not fine, don't use it at all".
