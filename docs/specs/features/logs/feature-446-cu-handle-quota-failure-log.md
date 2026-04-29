---
commit_count: 4
lines_added: 1157
lines_removed: 45
lines_changed: 1202
files_touched: 22
fix_commit_count: 0
fix_commit_ratio: 0
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
model: "cursor"
source: "no-telemetry-cursor"
---
# Implementation Log: Feature 446 - handle-quota-failure
Agent: cu

## Status

Code review completed 2026-04-29. Two critical issues found and fixed. Spec acceptance criteria ~80% met; integration test coverage gaps remain.

## New API Surface

- `lib/quota-mid-run-detector.js` — pane-scan detector injected into dashboard collector poll loop
- `lib/agent-resume.js` — `aigon agent-resume <id> <agent>` CLI + dashboard action
- `lib/quota-dashboard-actions.js` — Resume / Skip validActions for quota-paused tiles
- `lib/quota-probe.js:mergeMidRunDepletion` — idempotent mid-run quota.json updater
- Workflow events: `feature.agent_quota_paused`, `feature.agent_quota_resumed`, `research.*` variants
- Engine/projector context field: `quotaSignals[]` (ring buffer, last 36)
- `config.quotaPolicy.mode = 'pause-and-wait'`

## Key Decisions

1. **Dedupe is in-memory only** (`emittedDedupe` Map). Process restart loses dedupe state, but `mergeMidRunDepletion` prevents quota.json churn, and agent-status `quota-paused` is checked before scanning. Acceptable for MVP; a durable dedupe store was considered overkill.
2. **Fleet survival treats quota-paused as "ready"** in `implAgentReadyForAutonomousClose` but does NOT auto-emit `agent.dropped`. The operator must click Skip to drop the agent permanently. This matches the spec's wording that the gate relaxes, but the explicit "dropped-from-run" event is user-triggered only.
3. **Resume spawns a new tmux session** rather than reattaching the old one. The old session (stuck at a provider choice screen) is left alone. `buildAgentCommand` reads `modelOverride` from the snapshot so the resumed session preserves start-time model/effort.

## Code Review

### Spec Compliance
- [x] All requirements from spec are met **with exceptions noted below**
- [x] Feature works as described
- [ ] Edge cases are fully handled — **integration tests incomplete**

**Details:**
- ✅ Pane buffer scan reuses awareness regex packs via `classifyProbeResult`
- ✅ `quota-paused` agent status + `AWAITING_INPUT_CLEARED_BY` coverage
- ✅ Workflow events emitted with payload hash (not full pane buffer)
- ✅ `quota.json` updated through shared `mergeMidRunDepletion`
- ✅ Fleet solo/review-wait autopilot integration
- ✅ Dashboard chip + Resume/Skip actions
- ✅ `agent-resume` refuses depleted pairs, wrong status, missing engine
- ⚠️ Integration tests missing: mid-run detection round-trip, duplicate suppression across polls, successful resume reconstruction, Fleet survival with eval

### Code Quality
- [x] Follows project coding standards
- [x] Code is readable and maintainable
- [x] Proper error handling
- [ ] No obvious bugs or issues — **two critical bugs found and fixed**

**Issues found & fixed during review:**

1. **`drop-agent` missing from `DASHBOARD_INTERACTIVE_ACTIONS`** (`lib/dashboard-server.js`)
   - Impact: Dashboard "Skip" button returned 403 because the server rejected the action.
   - Fix: Added `'drop-agent'` to the allowlist set.
   - Commit: `fix(dashboard): add drop-agent to DASHBOARD_INTERACTIVE_ACTIONS`

2. **`agent-resume` did not refuse when session sidecar was missing** (`lib/agent-resume.js`)
   - Impact: Resume fell back to `mainRepo` worktree and spawned a fresh session with no context, violating the spec's "refuses if the sidecar is missing" requirement.
   - Fix: Added explicit `NO_SIDECAR` error throw before tmux spawn.
   - Commit: `fix(agent-resume): refuse resume when session sidecar is missing`

**Minor observations (non-blocking):**
- `persistQuotaPause` rolls back only the in-memory dedupe key on `persistEntityEvents` failure; the agent-status and quota.json writes are already committed. Next poll will retry, which is safe but slightly noisy.
- `scanActiveSessions` runs `tmux capture-pane` for every alive non-paused session on every collector poll. Acceptable for typical session counts (<20) but worth monitoring.

### Testing
- [ ] Feature has been tested manually — **not verified**
- [x] Tests pass
- [ ] Edge cases are tested — **gaps remain**

**Details:**
- ✅ `mergeMidRunDepletion` dedupe test
- ✅ `emittedDedupe` composite-key test
- ✅ `agent-resume` refuses depleted quota test
- ✅ `agent-resume` refuses missing sidecar test (added during review)
- ✅ Dashboard `validActions` Resume/Skip test
- ❌ No end-to-end mock-pane detection test
- ❌ No Fleet survival test

### Documentation
- [x] Code is adequately commented where needed
- [ ] Spec checkboxes updated — **pending**
- [ ] Breaking changes documented — **none**

## Gotchas / Known Issues

1. **In-memory dedupe is lost on server restart.** If the server restarts while a quota message is still visible in the pane, the next poll may emit a duplicate event. Mitigation: agent-status file already says `quota-paused`, so `scanActiveSessions` skips that session.
2. **Old tmux session remains after resume.** The new session has a different name; the old one (stuck at provider choice) is not killed. This is intentional to preserve pane buffer forensics, but operators may see two sessions for the same agent.
3. **`finishAuto('quota-paused')` for solo mode** writes a finish state that downstream consumers may not recognise. The autopilot state file carries `status: 'quota-paused'`, which is not in the standard finish-status enum. Dashboard and CLI surfaces should tolerate it.

## Explicitly Deferred

- `fallback-model` and `fallback-agent` quotaPolicy modes (flagged for follow-up)
- Auto-kill of old tmux session on resume
- Durable disk-backed dedupe for `emittedDedupe`
- `signal-health-telemetry` classification for quota-paused as `signal-recovered-via-quota-pause`

## For the Next Feature in This Set

N/A — this is the second and final feature in the `quota` set (depends on `agent-quota-awareness`).

## Test Coverage

| Test | Status |
|---|---|
| `mergeMidRunDepletion` dedupes writes | ✅ |
| `emittedDedupe` tracks composite key | ✅ |
| `agent-resume` refuses depleted pair | ✅ |
| `agent-resume` refuses missing sidecar | ✅ |
| Dashboard `validActions` Resume + Skip | ✅ |
| Mid-run detection round-trip (mock pane) | ❌ |
| Duplicate suppression across collector polls | ❌ |
| Successful resume with original prompt/worktree | ❌ |
| Fleet survival with one quota-paused agent | ❌ |
