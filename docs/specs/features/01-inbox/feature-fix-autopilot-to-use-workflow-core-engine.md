# Feature: fix autopilot to use workflow-core engine

## Summary

`feature-autopilot` and `research-autopilot` were never updated after the workflow-core engine was unified. Feature autopilot still monitors legacy `.aigon/state/` files instead of engine snapshots, and both autopilot types trigger eval/close by calling CLI commands directly rather than emitting engine state-transition events. This means `allAgentsReady` guards are never checked, orchestrated effect lifecycle (spec moves, eval template creation) never runs, and the engine state diverges from reality. This feature migrates both autopilot implementations to be fully engine-native.

## User Stories

- [ ] As a user running `aigon feature-autopilot`, I can trust that it waits for the workflow engine to confirm all agents are ready before triggering evaluation — not just legacy status files.
- [ ] As a user running `aigon research-autopilot`, I can trust that the eval phase is triggered via the engine, so all guards and effects run correctly.
- [ ] As a user, when autopilot progresses through phases, the dashboard reflects each transition in real time because the engine is the source of truth.

## Acceptance Criteria

### Feature autopilot: migrate to engine snapshot monitoring

- [ ] `feature-autopilot` monitor loop reads from `readWorkflowSnapshotSync()` (engine snapshot at `.aigon/workflows/features/{id}/snapshot.json`) instead of `readAgentStatus()` (legacy `.aigon/state/feature-{id}-{agent}.json`)
- [ ] Readiness check uses `snapshot.context.agents[agent].status === 'ready'` instead of `agentState.status === 'submitted'`
- [ ] If no agent entries exist in the snapshot yet (engine not yet initialised), autopilot handles gracefully (retry, don't crash)

### Both autopilots: emit engine events for state transitions

- [ ] When all agents are ready, `feature-autopilot` emits a `feature.eval` or `feature.review` engine event (via `selfCommands['feature-eval']` or equivalent engine-aware method) rather than calling the CLI command directly as a fire-and-forget
- [ ] When all agents are ready, `research-autopilot` emits a `research.eval` engine event rather than calling CLI directly
- [ ] After emitting the eval event, autopilot waits for the engine snapshot to confirm the transition (e.g. `snapshot.currentSpecState === 'evaluating'`) before printing "evaluation started" and exiting
- [ ] If the `allAgentsReady` guard fails (agents not all ready per engine), autopilot logs a clear error and does not proceed to eval

### Ralph auto-submit signal path

- [ ] Verify that Ralph's auto-submit code path (in `lib/validation.js`) calls `aigon agent-status submitted` (the CLI command that writes `.aigon/state/` AND emits the engine signal) rather than writing the state file directly
- [ ] If it writes directly, fix it to go through the CLI command or call `writeAgentStatus` + `emitSignal` consistently

### Regression safety

- [ ] `node -c lib/commands/feature.js` passes
- [ ] `node -c lib/commands/research.js` passes (or wherever research-autopilot lives)
- [ ] `npm test` passes
- [ ] Manual smoke test: `aigon feature-autopilot <id> cc` on a test feature completes without hanging in the monitor loop

## Validation

```bash
node -c lib/commands/feature.js
node -c aigon-cli.js
npm test
```

## Technical Approach

### Feature autopilot monitor loop fix

In `lib/commands/feature.js` around line 2497, the monitor loop currently does:

```js
// CURRENT (broken):
const agentState = readAgentStatus(featureNum, agent);
if (agentState?.status === 'submitted') { ... }

// FIXED:
const snap = readWorkflowSnapshotSync(mainRepo, featureNum);
const agentCtx = snap?.context?.agents?.[agent];
if (agentCtx?.status === 'ready') { ... }
```

Mirror the pattern already working in research-autopilot (lines 754–767 in `lib/commands/research.js` or equivalent).

### Engine event emission for eval transition

Instead of:
```js
// CURRENT (broken):
await selfCommands['feature-eval']([featureNum]);
```

The autopilot should emit the engine event and wait for confirmation:
```js
// FIXED:
await selfCommands['feature-eval']([featureNum]);  // this already calls engine — verify it does
// Then poll snapshot until currentSpecState === 'evaluating'
```

**Key investigation needed**: verify whether `feature-eval` and `research-eval` already emit engine events internally or if they bypass the engine. If they already go through the engine, the fix is mainly the monitoring source. If they bypass, both the CLI command and the autopilot caller need updating.

### Ralph signal path audit

In `lib/validation.js`, locate the auto-submit section (~line 611) and verify:
```js
writeAgentStatus(featureNum, agentId, {status: 'submitted'});
```
This must also emit the engine signal `agent-ready`. Either:
- Replace with a call to `aigon agent-status submitted` (which handles both), or
- Explicitly call `wf.emitSignal(mainRepo, featureNum, 'agent-ready', agentId)` after `writeAgentStatus`

### Shell trap (no change needed)

The shell trap in `buildAgentCommand()` already calls `aigon agent-status submitted`, which triggers both the legacy write and the engine signal. This path is correct and should not be changed.

## Dependencies

- `lib/workflow-core/` — engine snapshot reading (`readWorkflowSnapshotSync`)
- `lib/commands/feature.js` — feature autopilot monitor loop (~line 2497)
- `lib/commands/research.js` (or wherever research-autopilot lives) — research eval trigger
- `lib/validation.js` — Ralph auto-submit signal path (~line 611)

## Out of Scope

- Changing how autopilot spawns agents (worktree creation, tmux sessions — these work correctly)
- Adding new autopilot subcommands or flags
- Changing the eval or review logic itself (only the trigger path)
- Automated retries on agent failure (separate feature)

## Open Questions

- Does `feature-eval` CLI command already emit a `feature.eval` engine event internally, or does it bypass the engine? This determines whether the eval trigger fix is in autopilot or inside `feature-eval` itself.
- Should autopilot poll indefinitely waiting for the engine eval transition, or time out with a clear error message?

## Related

- Commits that broke this: `cb384278 feat: remove legacy engine bypasses`, `b66383af feat: unify feature and research workflow engine`
- `lib/workflow-core/` — engine, machine, projector
- `lib/feature-workflow-rules.js` — `allAgentsReady` guard definition
- `lib/commands/misc.js` — `agent-status` command that writes state + emits engine signal
- `lib/validation.js` — Ralph autonomous loop and auto-submit
