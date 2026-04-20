# Feature: fix-entity-submit-silent-signal-loss

## Summary
`entitySubmit` in `lib/entity.js` emits the `agent-submitted` workflow signal as fire-and-forget and swallows every error with `.catch(() => {})`. When two agents submit concurrently (for example two `aigon research-submit <ID> <agent>` calls or two `aigon agent-status submitted` calls for the same feature), the second caller's `fs.open(lockPath, 'wx')` in `withFeatureLock` throws `EEXIST`, the promise is silently discarded, and the workflow event is never appended — while the CLI still prints `✅ submitted` because the per-agent status file write (the "derived cache") succeeds unconditionally.

Net effect: the events log and the workflow snapshot diverge from the per-agent status files, leaving research/feature workflows stuck in `implementing` with one agent perpetually `running` even though findings are complete. We hit this live on research 34 on 2026-04-20 while resurrecting three stalled Fleet agents.

The fix is to make the workflow-core signal write authoritative for submit-related state changes: retry on lock contention, surface non-retryable errors, and stop treating the status file as a fallback that can mask engine failures.

## User Stories
- [ ] As an agent (or human running `aigon research-submit`/`agent-status submitted`), when my submit command prints success, I can trust the workflow engine recorded the event — not just the per-agent status file cache.
- [ ] As the conductor (AutoConductor / dashboard), when I observe `allReady` in the snapshot it accurately reflects every submitted agent, so `research-eval` / `feature-close` fires without manual resubmits.
- [ ] As a developer, when a workflow signal cannot be persisted, I see an error instead of a phantom success.

## Acceptance Criteria
- [ ] `entitySubmit` no longer swallows workflow signal failures with a bare `.catch(() => {})`. For feature and research entities, a failed submit signal causes the command to exit non-zero and print an actionable error instead of `✅ submitted`.
- [ ] The workflow-core lock path used by `emitSignal` retries `EEXIST` collisions with bounded backoff before failing. `tryWithFeatureLock` retains its current non-blocking semantics for callers that explicitly want "busy" behavior.
- [ ] `entitySubmit` writes the workflow event before `writeAgentStatus(...)`. If the workflow event cannot be persisted after retries, the status file is not updated to `submitted`.
- [ ] Running two `aigon research-submit <ID> <agent>` commands for the same research in parallel results in **both** `signal.agent_submitted` events in `events.jsonl` and both agents reflected in `snapshot.json` — no manual retry required.
- [ ] Same guarantee for two `aigon agent-status submitted` calls racing on a feature.
- [ ] Regression test (in `tests/`, with the `// REGRESSION:` comment per Rule T2) that spawns two concurrent submit calls against the same entity and asserts both events land, the snapshot reflects both agents as submitted, and the command rejects instead of writing a stale status file when the signal path is forced to fail.
- [ ] `docs/architecture.md` note under State Architecture / Write-Path Contract updated: status files are a cache of engine state, not a fallback — if the engine write fails, the CLI must fail too.

## Validation
```bash
node -c lib/entity.js
node -c lib/workflow-core/engine.js
node -c lib/workflow-core/lock.js
npm test
bash scripts/check-test-budget.sh
```

## Technical Approach
**Root cause trace (confirmed live on research 34):**
1. `lib/commands/research.js:680` → `entity.entitySubmit(def, researchNum, agentId, ctx)`
2. `lib/entity.js:863-871`:
   ```js
   _wf().emitSignal(process.cwd(), id, 'agent-submitted', agentId, entityType ? { entityType } : {})
       .catch(() => { /* best-effort — engine may not be initialised for this entity yet */ });
   writeAgentStatus(id, agentId, { status: 'submitted', flags: {} }, def.prefix);
   console.log(`✅ ${...} submitted (${agentId})`);
   ```
3. `lib/workflow-core/engine.js:697-713` → `emitSignal` wraps work in `withFeatureLock`.
4. `lib/workflow-core/lock.js:22-31` → `withFeatureLock` calls `fs.open(lockPath, 'wx')` — no retry. Second concurrent caller gets `EEXIST` and throws.
5. Thrown error is swallowed at step 2 by `.catch(() => {})`. Status file write (step 2, line 869) still succeeds. CLI prints ✅.

**Observed on research 34** (`events.jsonl` before the second manual retry):
```
{"type":"signal.agent_submitted","agentId":"gg","at":"2026-04-19T14:37:45.404Z"}
{"type":"signal.agent_submitted","agentId":"cc","at":"2026-04-20T04:02:15.382Z"}
# cu's event missing despite ✅ submitted (cu) printed
```
After serial retry: cu's event finally landed (`04:02:50.327Z`).

**Proposed fix shape:**
1. **Own retry semantics in workflow-core.** Add a retrying lock helper in `lib/workflow-core/lock.js` (or equivalent helper consumed by `emitSignal`) that retries `EEXIST` with jittered backoff (100ms × 2^n, cap about 2s, about 5 attempts). `lib/workflow-core/engine.js` should use that helper for signal persistence. `tryWithFeatureLock` (non-blocking) stays for effect-claim paths that want "busy" semantics.
2. **Make submit failure explicit in `lib/entity.js`.** Remove the fire-and-forget `.catch(() => {})` from `entitySubmit`. For workflow-core-backed feature and research entities, distinguish "workflow is not initialised" from retryable lock contention and from hard I/O failures, and surface the latter two to the CLI caller.
3. **Preserve write-path ordering.** Write the engine event first, then the status file cache. If the engine write fails, do not write the stale cache and do not print the success line.
4. **Constrain the audit scope.** Audit submit-related signal call sites in `lib/entity.js`, `lib/commands/misc.js`, and the shell-trap path for the same anti-pattern, but do not expand this feature into heartbeat delivery, dashboard-only logic, or unrelated workflow transitions.

**Key design constraint:** per the Write-Path Contract in CLAUDE.md, every write path must produce the engine state its matching read path assumes exists. The current code violates this by letting the status file (read by the dashboard + shell traps) drift ahead of the engine (read by AutoConductor + `availableActions`).

## Dependencies
- None. Self-contained in `lib/entity.js`, `lib/workflow-core/lock.js`, `lib/workflow-core/engine.js`, and tests.

## Out of Scope
- Rewriting the lock mechanism to use advisory locks (flock) or a lock server. File-create locking is fine; we just need retry.
- Making the status files go away entirely. They're still useful as a fast read cache for the dashboard and as the shell-trap signal target. They just shouldn't be written when the engine write failed.
- Research-eval / feature-close concurrency. Different lock paths, different semantics — this feature only covers signal emission from submit/ready/status-change paths.
- Adding user-configurable retry knobs, dashboard affordances, or a second recovery path in read-side code. This fix belongs on the centralized write path.

## Open Questions
- Should retry attempts be configurable via env var / `.aigon/config.json`, or hard-coded? (Lean: hard-coded with sensible defaults; add config only if a user hits the ceiling.)
- On exhaustion (all retries fail), do we fail the CLI command hard, or fail soft with a visible warning and an `aigon doctor --reconcile` suggestion? (Lean: fail hard for submit/ready paths; users can retry. Soft-fail only hides bugs.)
- Are there any signal paths where fire-and-forget is genuinely correct (e.g. heartbeat pings)? Audit needed. Heartbeats can probably still tolerate loss — they're idempotent and frequent. Submits cannot.

## Related
- Research: — (none; surfaced directly from research-34 incident)
- Incident evidence: `.aigon/workflows/research/34/events.jsonl` (8→9 event gap between parallel cc/cu submit and the manual cu resubmit at `2026-04-20T04:02:50.327Z`)
- Related write-path bugs (CLAUDE.md § Write-Path Contract): F270 `1c2766bc`, F272 `cbe3aeba`/`98ed172b`, AutoConductor `b9c39a26`
