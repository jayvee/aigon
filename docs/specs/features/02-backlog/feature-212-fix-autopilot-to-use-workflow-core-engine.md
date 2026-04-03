# Feature: fix autopilot to use workflow-core engine

## Summary

`feature-autopilot` and `research-autopilot` were never fully updated after the workflow-core engine was unified. `research-autopilot` already monitors engine snapshots, but `feature-autopilot` still depends on legacy `.aigon/state/` files and spawns autonomous sessions through a raw `feature-do --autonomous` command instead of the wrapped agent launcher. That bypass means feature autopilot can miss shell-trap signalling, main-repo routing, and engine-ready transitions. This feature makes both autopilot implementations engine-native, with the workflow snapshot as the primary source of truth and autonomous agents signaling the main repo workflow state reliably.

## User Stories

- [ ] As a user running `aigon feature-autopilot`, I can trust that it waits for the workflow engine to confirm all agents are ready before triggering evaluation — not just legacy status files.
- [ ] As a user running `aigon research-autopilot`, I can trust that the eval phase is triggered via the engine, so all guards and effects run correctly.
- [ ] As a user, when autopilot progresses through phases, the dashboard reflects each transition in real time because the engine is the source of truth.

## Acceptance Criteria

### Feature autopilot: migrate to engine snapshot monitoring

- [ ] `feature-autopilot` monitor loop reads from `readWorkflowSnapshotSync()` (engine snapshot at `.aigon/workflows/features/{id}/snapshot.json`) instead of `readAgentStatus()` (legacy `.aigon/state/feature-{id}-{agent}.json`)
- [ ] Readiness check uses `snapshot.agents[agent].status === 'ready'` instead of `agentState.status === 'submitted'`
- [ ] If no agent entries exist in the snapshot yet (engine not yet initialised), autopilot handles gracefully (retry, don't crash)
- [ ] `feature-autopilot status` also uses workflow snapshots as the primary source and only falls back to legacy `.aigon/state/` status files when no engine snapshot exists

### Feature autopilot: align autonomous spawn path with engine signaling

- [ ] `feature-autopilot` spawns autonomous agent sessions through the same wrapped launcher path used by `feature-start` / `buildAgentCommand()` so shell traps, heartbeat, and main-repo routing are active in autopilot mode
- [ ] A successful autonomous feature session updates the main repo workflow snapshot so the corresponding engine agent status becomes `ready` without requiring `feature-eval` to synthesize readiness from legacy `.aigon/state/` files
- [ ] Feature autopilot no longer depends on local worktree-only status writes to detect completion

### Both autopilots: trigger eval through the engine-backed command path

- [ ] When all agents are ready per the engine snapshot, `feature-autopilot` invokes the existing engine-aware `feature-eval` command path rather than any legacy direct file/state manipulation
- [ ] When all agents are ready per the engine snapshot, `research-autopilot` invokes the existing engine-aware `research-eval` command path
- [ ] After emitting the eval event, autopilot waits for the engine snapshot to confirm the transition (e.g. `snapshot.currentSpecState === 'evaluating'`) before printing "evaluation started" and exiting
- [ ] If the `allAgentsReady` guard fails (agents not all ready per engine), autopilot logs a clear error and does not proceed to eval

### Ralph auto-submit signal path

- [ ] Ralph's auto-submit code path (in `lib/validation.js`) routes completion through the same main-repo signaling path as `aigon agent-status submitted`, rather than only writing a local status file
- [ ] If Ralph retains a direct write path, it must also emit the corresponding engine-ready signal to the main repo consistently

### Regression safety

- [ ] `node -c lib/commands/feature.js` passes
- [ ] `node -c lib/commands/research.js` passes (or wherever research-autopilot lives)
- [ ] `npm test` passes
- [ ] Manual smoke test: `aigon feature-autopilot <id> cc gg` on a test feature completes without hanging in the monitor loop
- [ ] Manual smoke test: `aigon research-autopilot <id> cc gg` on a test research topic completes without hanging in the monitor loop

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
const agentCtx = snap?.agents?.[agent];
if (agentCtx?.status === 'ready') { ... }
```

Mirror the pattern already working in research-autopilot (lines 754–767 in `lib/commands/research.js` or equivalent).

### Feature autopilot spawn path fix

`feature-autopilot` should not spawn raw tmux commands like:

```js
// CURRENT (broken):
aigon feature-do <id> --autonomous --auto-submit --agent=<agent>
```

in a way that bypasses the wrapped `buildAgentCommand()` launcher. The feature autopilot path should reuse the same shell-trap and heartbeat wrapper used by `feature-start` so autonomous sessions report status back to the main repo workflow consistently.

### Engine-backed eval transition

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

`feature-eval` and `research-eval` are already expected to be the engine-aware transition path. The autopilot fix is to invoke those commands only after engine-observed readiness, and to treat the resulting workflow snapshot transition as the confirmation of success.

### Ralph signal path audit

In `lib/validation.js`, locate the auto-submit section (~line 611) and replace the local-only completion shortcut:
```js
writeAgentStatus(featureNum, agentId, {status: 'submitted'});
```
This must update the main repo workflow state, not just a local status file. Either:
- Replace with a call to `aigon agent-status submitted` (which handles both the legacy write and engine signal), or
- Explicitly call `wf.emitSignal(mainRepo, featureNum, 'agent-ready', agentId)` after a main-repo-directed status write

### Shell trap

The shell trap in `buildAgentCommand()` already calls `aigon agent-status submitted`, which triggers both the legacy write and the engine signal. This path is correct and should not be changed.

## Dependencies

- `lib/workflow-core/` — engine snapshot reading (`readWorkflowSnapshotSync`)
- `lib/commands/feature.js` — feature autopilot monitor loop (~line 2497)
- `lib/commands/research.js` (or wherever research-autopilot lives) — research eval trigger
- `lib/worktree.js` — wrapped agent launcher / shell trap path
- `lib/validation.js` — Ralph auto-submit signal path (~line 611)

## Out of Scope

- Adding new autopilot subcommands or flags
- Changing the eval or review logic itself (only the trigger path)
- Automated retries on agent failure (separate feature)

## Open Questions

- Should autopilot poll indefinitely waiting for the engine eval transition, or time out with a clear error message?

## Related

- Commits that broke this: `cb384278 feat: remove legacy engine bypasses`, `b66383af feat: unify feature and research workflow engine`
- `lib/workflow-core/` — engine, machine, projector
- `lib/feature-workflow-rules.js` — `allAgentsReady` guard definition
- `lib/commands/misc.js` — `agent-status` command that writes state + emits engine signal
- `lib/validation.js` — Ralph autonomous loop and auto-submit
