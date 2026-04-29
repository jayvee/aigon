---
complexity: high
---

# Feature: handle-quota-failure

## Summary

When an agent hits a provider quota cap mid-task (e.g. *"Usage limit reached for all Pro models. Access resets at 1:43 PM GMT+10."* from Gemini Code Assist), the tmux session enters an interactive choice prompt and stops making progress. There is no signal back to Aigon, so the dashboard shows the agent as `implementing` / `researching` indefinitely, autopilot loops poll for a completion event that will never arrive, and the user is the only path to recovery — they have to notice, attach to the tmux session, kill it, and restart with a different agent or model.

This feature adds a quota-failure detection + recovery pathway so that a quota-capped session does not silently stall out the workflow. Two sessions on 2026-04-28 (research 45 gg, research 46 gg) demonstrated the failure: both got as far as `ReadFile AGENTS.md` and a single shell call, then idled at the "Switch to flash / Upgrade / Stop" choice screen for hours.

## User Stories

- [ ] When my Gemini agent hits the daily Pro quota mid-feature, I want Aigon to notice within the next poll cycle, mark the session paused with a clear reason, and either retry on a fallback model (if configured) or hand the work off to the next agent in line — not block the whole feature on me discovering it manually.
- [ ] When I'm running an autonomous feature overnight and one of three Fleet agents hits a quota cap, I want the other two to keep progressing and the dashboard to surface the capped one as a single "needs your attention" tile, not silently stall the whole feature.
- [ ] When a code-review agent hits a quota cap mid-review, I want it to gracefully restart on a different reviewer rather than leave the implementing agent waiting on a `review-complete` signal that will never arrive.
- [ ] When quota resets at the documented reset time, I want to be able to one-click resume the paused session without losing context (transcript, prior partial output, in-flight git state).

## Acceptance Criteria

- [ ] A new `quota-exhausted` failure category is recognised by the existing `failureDetectors.tokenExhaustion` machinery in `templates/agents/*.json` — separate from generic `tokenExhaustion` so that quota (recoverable on reset) is distinguishable from credit balance (recoverable on top-up) and context window (recoverable on conversation prune).
- [ ] At least one stderr/stdout pattern per agent is registered for the quota case (`gg`: "Usage limit reached for all Pro models", "Access resets at"; `cc`: "rate limit", "usage limit"; `cx`: TBD; `cu`: TBD). Patterns are config-driven, not hardcoded in detector logic.
- [ ] When the detector fires, the agent's status moves to a new `quota-paused` lifecycle signal (added alongside `awaiting-input`, `paused`, `error` in `lib/agent-status.js`). The signal carries: `{ provider, capDetail, resetAt? (ISO when parsed from message), detectedAt }`.
- [ ] The dashboard renders quota-paused agents with a distinct chip ("⏸ Quota — resets 13:43") and a "Restart on fallback model" action that re-launches the agent with the next-cheapest model from the same family (or, if none, the next agent in the configured fleet rotation).
- [ ] Autopilot (`feature-autonomous.js`, `research-autopilot`) treats `quota-paused` as a non-blocking terminal state for that agent within the current run: in Fleet mode, the run continues with the surviving agents; in solo mode, the run finishes with status `quota-paused` rather than spinning forever.
- [ ] A `feature.agent_quota_paused` / `research.agent_quota_paused` event is appended to the engine event log so post-mortem analytics can attribute lost runtime to quota events (input for the existing learned-recommender corpus, F-TBD).
- [ ] When the agent is dropped from a Fleet run due to quota, the rest of the agents finish their work and `feature-eval` / `research-eval` is offered with the surviving agents only — no requirement that all three submit.
- [ ] An explicit `aigon agent-resume <id> <agent>` (or dashboard "Resume" button) re-launches the paused tmux session with the same prompt body, reuses the existing worktree, and re-attaches transcript capture.
- [ ] At least one integration test (mock provider, scripted stderr) validates the detect → status-write → autopilot-skip flow end-to-end. This is non-negotiable per `feedback_validate_with_real_tools_first`.
- [ ] Per-agent quarantine flag remains supported — operators who want a known-flaky model just disabled, not auto-recovered, set `quarantined: true` in `modelOptions[].quarantined` per `feedback_quarantine_bad_models`.

## Validation

```bash
node --check lib/agent-status.js
node --check lib/feature-autonomous.js
node --check lib/agent-failure-detectors.js
npm test -- --testPathPattern='(agent-status|quota|autonomous)'
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.
- May add new agent-status lifecycle signals (`quota-paused`, etc.) to `lib/agent-status.js` and `feature-workflow-rules.js` / `research-workflow-rules.js` as needed; this is the whole point of the feature.

## Technical Approach

The pieces, roughly in dependency order:

### 1. Detection — extend the existing `failureDetectors` config

Each agent JSON already has a `failureDetectors.tokenExhaustion` block listing exit codes and stderr patterns. Add a sibling `quotaExhaustion` block:

```json
"failureDetectors": {
  "quotaExhaustion": {
    "patterns": [
      "Usage limit reached for all Pro models",
      "Access resets at",
      "quota exceeded for"
    ],
    "resetTimeRegex": "Access resets at (\\d{1,2}:\\d{2})\\s*(?:[AP]M)?\\s*(GMT[+-]?\\d+)?",
    "scope": "stderr+stdout+pane"
  }
}
```

`scope: pane` is important — Gemini's quota message is rendered in a TUI choice box, not on stderr. Detection has to scan the rendered tmux pane. The existing transcript/pipe-pane capture (F430) gives us this surface for free.

### 2. The detector loop

Add `lib/agent-failure-detectors.js` (single module, no abstraction explosion) that:

- Reads the captured pane buffer for each active agent every N seconds (re-use the existing dashboard polling cadence; 5s is fine).
- Matches against the agent's configured patterns.
- On a hit, parses optional reset time from the message and emits a structured event: `{ kind: 'quota-exhausted', agent, sessionName, capturedAt, resetAt }`.

Defense-in-depth: also detect via the existing CLI hook surface (cc has `Stop` hooks at line 332 of `cc.json`); when a Stop hook fires after only a few turns, that's an additional signal that something's gone wrong.

### 3. Status writes

Add `quota-paused` to the `AGENT_STATUS_VALID_VALUES` set in `lib/agent-status.js` and to the awaiting-input clear set. Plumb through the workflow rules:

- `feature-workflow-rules.js`: `implementing | code_review_in_progress | code_revision_in_progress` → `agent_quota_paused` (per-agent flag, not entity-level state — the entity stays `implementing` if other agents are still running).
- `research-workflow-rules.js`: same.

The entity-level state should NOT change on a single agent quota event — only when *all* live agents in a Fleet are quota-paused do we want to treat the whole entity as stuck.

### 4. Autopilot integration

`feature-autonomous.js` and `research-autopilot.js` poll for completion. Add: when reading agent status, treat `quota-paused` as `terminal-skip` — the agent is done participating in this run, but not "submitted" and not "errored". Specifically:

- Fleet mode: skip the agent in the readiness count for `feature-eval` / `research-eval`. The eval gate becomes "all agents have submitted OR are quota-paused" rather than "all agents have submitted."
- Solo mode: there's no fallback; finish the autopilot run with status `quota-paused`, surface to the user, do NOT loop.

### 5. Recovery options (in order of automation)

Three modes, picked by config (`.aigon/config.json` → `quotaPolicy`):

a. **`fallback-model`** — re-launch on the next-cheapest model in the same `modelOptions` array. For gg, that's `gemini-3-flash-preview`. The prompt body, worktree, and any partial git state survive; we resume the same tmux session with a different model flag.

b. **`fallback-agent`** — drop the capped agent from the fleet, mark it `quota-paused`, and let the others finish. This is what we want for Fleet mode where redundancy already exists.

c. **`pause-and-wait`** — write the reset time to the engine event log, surface a "Resume at 13:43" countdown on the dashboard, and let the user decide whether to manually resume after reset. This is the safest default and what we should ship first.

The first cut should ship `pause-and-wait` only. `fallback-model` and `fallback-agent` are follow-ups gated on observed user demand.

### 6. Resume path

Add `aigon agent-resume <id> <agent>` that:

- Reads the paused session's metadata sidecar (`.aigon/sessions/<sessionName>.json`).
- Reconstructs the tmux launch command from the saved prompt + agent + worktree path.
- Writes status back to whatever the pre-quota status was (typically `implementing`).
- Routes through the same `createDetachedTmuxSession` path as the original launch — no new code path.

### 7. UX / dashboard surface

A single chip per agent tile: `⏸ Quota — resets 13:43 [Resume] [Skip]`. "Skip" drops the agent from the fleet permanently for this run. "Resume" does the agent-resume above. This is small and additive — shouldn't touch the rest of the dashboard.

### Why not a separate "circuit breaker" abstraction

There's a temptation to build a pluggable circuit breaker that wraps every agent invocation and handles all failure modes uniformly (quota, network, OOM, exit code, idle, …). Don't. The failure modes are too different (quota wants to wait for reset, OOM wants to retry, network wants exponential backoff, idle wants user attention). A specific quota-handling path that re-uses the existing `failureDetectors` and `agent-status` plumbing is the right scope. If two more failure categories surface a generalised abstraction *empirically*, refactor then.

## Dependencies

- F430 (pipe-pane transcript capture) — provides the pane-buffer surface that the detector reads. Already shipped.
- F-TBD (learned recommender) — would consume the new `agent_quota_paused` events for cost prediction. Optional; quota feature does not depend on it.

## Out of Scope

- General "agent stuck" detection (idle pattern matching beyond quota). The existing `idleDetection.idlePattern` in agent JSON covers that orthogonally.
- Cross-provider quota arbitrage ("the cheapest agent right now is X, switch to it preemptively"). That's a recommender concern, not a failure-handling concern.
- Charging metering / dollar-budget enforcement. Already covered by the existing cost telemetry; quota is about provider cap, not user budget.
- Auto-purchase / auto-upgrade of quota tiers. Even if technically possible, this is a payment side-effect we should never trigger automatically.

## Open Questions

- Does Gemini CLI surface a parseable error code for quota, or only the TUI text? If only text, we are committed to pane-buffer scanning. (Spike needed during implementation.)
- For Codex (cx) and Cursor (cu), what is the quota-cap message format? Need to capture real examples before adding patterns. Until then, they fall through the existing generic `tokenExhaustion` detector.
- What is the right default for `quotaPolicy`? Likely `pause-and-wait` for solo mode and `fallback-agent` for Fleet, but worth a brief look at the F313 recommender patterns to see how other defaults are picked.
- Should `quota-paused` clear the awaiting-input flag? Probably yes — the agent isn't waiting on the user, it's waiting on the provider clock. Add to `AWAITING_INPUT_CLEARED_BY` in `agent-status.js`.

## Related

- Triggered by 2026-04-28 incident: research 45 (cc, cu, gg failed to signal completion) and research 46 (gg quota cap on first turn). Investigation captured in conversation; not committed to a separate doc.
- Memory pointer: `feedback_quarantine_bad_models.md` — for the case where a model misbehaves persistently rather than transiently. Quarantine and quota are complementary: quota is "this agent is fine, just throttled right now"; quarantine is "this agent is not fine, don't use it at all."
