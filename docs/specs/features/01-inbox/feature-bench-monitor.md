---
complexity: high
---

# Feature: bench monitor

## Summary

Running `aigon perf-bench brewboard --all` is a black box: there is no way to see what is currently running, how much it has cost, or whether a process is stuck. On 2026-04-30, a single `openrouter/z-ai/glm-5.1` OpenCode session ran for 10+ hours after hitting an OpenRouter monthly key limit, burning through the full credit balance with no alert. Three models (glm-5.1, qwen3-next-80b-a3b-thinking, nemotron-3-super-120b-a12b) each timed out 2-3 times before being manually quarantined. This feature adds four capabilities to close those gaps: (1) a `bench-status` command that shows live running benchmark processes with elapsed time and timeout warnings, (2) per-run cost capture surfaced in summary files and the summary table, (3) process kill-on-timeout so timed-out runs don't leave zombie opencode sessions, and (4) auto-quarantine that marks a model quarantined in the agent JSON after N consecutive timeouts.

## User Stories

- As John running a full matrix sweep, I want to run `aigon bench-status` and immediately see which model is currently being benchmarked, how long it has been running, and whether it has exceeded the expected ceiling — so I can decide whether to intervene.
- As John reviewing a completed sweep, I want the summary table printed at the end to show cost per run alongside timing, and I want the `all-*.json` summary file to contain that data so I can analyse it later.
- As John cleaning up after a crash, I want to know that when a benchmark times out the orchestrator kills the underlying opencode/agent process — so I never again find a 10-hour zombie burning credits.
- As John iterating on model selection, I want the bench harness to notice when a model has failed N consecutive runs and automatically add a quarantine block to its entry in the agent JSON — so I don't have to quarantine manually and the problem can't recur silently.

## Acceptance Criteria

- [ ] `aigon bench-status` lists all currently running benchmark-related processes (opencode or other agent binaries whose cwd is a seed-repo worktree), including PID, model name (from `--model` flag if present), elapsed time, and a `⚠ STUCK (>Nm past ceiling)` warning when elapsed > benchmark ceiling + 5 min.
- [ ] `aigon bench-status` exits 0 when no benchmark is running and prints "No benchmark processes running."
- [ ] Per-pair results stored in `all-*.json` summary files include `costUsd`, `tokenUsage` (full token breakdown), and `totalMs` fields, not just `ok`/`error`.
- [ ] The summary table printed at the end of `--all` sweeps shows `$X.XXXX` cost per passing run, and a `Total cost: $X.XXXX` line after the table.
- [ ] When `waitForAgentStatus` times out in `runBenchmark`, the harness kills the spawned opencode/agent process (SIGTERM, then SIGKILL after 5 s) before throwing the timeout error.
- [ ] After a run times out, any child processes forked by the agent binary in the same process group are also killed (use `process.kill(-pid, 'SIGTERM')` on the pgid).
- [ ] When a model accumulates N consecutive timeout failures across `runBenchmark` calls in a single `runAllBenchmarks` sweep (default N=3, configurable via `--auto-quarantine-after`), the harness writes a `quarantined` block into the model's entry in the agent JSON file with `since`, `reason`, `evidence`, and `supersededBy: []`, then skips remaining runs for that model.
- [ ] Auto-quarantine prints a visible `⚠ Auto-quarantining <model> after N consecutive timeouts` line and records `autoQuarantined: true` in the affected pair entry in the summary JSON.
- [ ] For `op` (OpenCode) runs, cost is read from the OpenCode SQLite database (`~/.local/share/opencode/opencode.db`, table `message`, column `cost` or equivalent) after the run completes, and stored in `tokenUsage.costUsd` in the result.
- [ ] `npm test` passes with no new failures.

## Validation

```bash
node --check lib/perf-bench.js
node --check lib/bench-status.js
node -e "const b = require('./lib/perf-bench'); console.log(typeof b.runBenchmark, typeof b.runAllBenchmarks)"
node -e "const s = require('./lib/bench-status'); console.log(typeof s.getRunningBenchmarkProcesses)"
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.
- May read `~/.local/share/opencode/opencode.db` in WAL read-only mode to extract cost data for `op` runs.
- May write `quarantined` blocks to `templates/agents/op.json` (and other agent JSONs) as part of the auto-quarantine path — this is the intended write surface for quarantine metadata.

## Technical Approach

### 1. `aigon bench-status` — new command in `lib/commands/misc.js`

Detect running benchmark processes by scanning `ps aux` output for:
- `opencode-ai/bin/.opencode` processes whose cwd (from `lsof -p <pid>`) is under a known seed path (`~/src/brewboard`, etc.) or whose `--model` flag matches a known `openrouter/*` model.
- Any process started by `runShell` in `perf-bench.js` — these can be identified because they have `aigon feature-start` in their args or their cwd is a seed repo path.

Use `spawnSync('ps', ['aux'])` + filter by known patterns. For each match, use `lsof -p <pid>` (or `/proc/<pid>/cwd` on Linux) to get the working directory and elapsed time.

Print a table:
```
PID    AGENT  MODEL                                  ELAPSED   STATUS
51163  op     openrouter/z-ai/glm-5.1               10h25m    ⚠ STUCK (>5m past 10m ceiling)
83730  op     (default)                              3d7h      ⚠ STUCK
```

### 2. Cost in summary files — already partially applied

`runAllBenchmarks` now pushes `costUsd` and `tokenUsage` into each pair result (done in this session). The summary table already shows cost. The remaining gap is cost capture for `op` runs (see §4).

### 3. Kill-on-timeout in `runBenchmark`

Currently, `waitForAgentStatus` times out and throws, but the opencode process started by `runShell('aigon', ['feature-start', ...])` is a synchronous spawnSync call that has already returned. The actual opencode process is a grandchild (aigon → tmux → opencode). The problem is `feature-start --background` returns immediately after spawning the tmux session.

Fix: after the timeout fires, call `aigon sessions-close <featureId>` on the seed repo to kill the tmux session and all agent processes. This is the correct kill path because it matches what the user would do manually.

```js
if (!ok) {
    // Kill the stuck agent session before throwing
    try {
        runShell('aigon', ['sessions-close', seed.featureId], { cwd: seed.seedPath, stdio: 'ignore' });
    } catch (_) { /* best-effort */ }
    throw new Error(`Timed out waiting for ${agent} to signal implementation-complete`);
}
```

### 4. OpenCode cost capture from SQLite

After `waitForAgentStatus` resolves for an `op` run, query the OpenCode database:

```js
// lib/opencode-cost.js
function readOpRunCost({ sessionStartMs, sessionEndMs }) {
    const dbPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
    if (!fs.existsSync(dbPath)) return null;
    // Use better-sqlite3 (already in devDeps or add it) in read-only mode
    // SELECT SUM(cost) FROM message WHERE time BETWEEN startMs AND endMs AND role='assistant'
    // Returns { costUsd, inputTokens, outputTokens }
}
```

If `better-sqlite3` is not available, fall back to the existing `readBenchmarkTelemetryUsage` path (which already handles op via the `opencode-db` strategy). Check whether `lib/telemetry.js` already reads the OpenCode DB for the `opencode-db` strategy — if it does, just wire it up correctly in the `runBenchmark` flow rather than adding a second reader.

### 5. Auto-quarantine in `runAllBenchmarks`

Track `consecutiveTimeouts: Map<modelValue, number>` across the sweep loop. When a run throws a timeout error, increment. When it reaches the threshold (default 3, or `--auto-quarantine-after N`):

1. Load the agent JSON for the agent ID.
2. Find the model entry by `value`.
3. Add `quarantined: { since, reason, evidence, supersededBy: [] }`.
4. Write the file back.
5. Remove remaining pairs for that model from the queue.
6. Add `autoQuarantined: true` to the pair entry in `results`.

The evidence string should name the sweep summary file (timestamped) so future readers can trace back.

### Existing code surfaces touched

- `lib/perf-bench.js` — kill-on-timeout, auto-quarantine loop, cost in summary
- `lib/commands/misc.js` — add `bench-status` command (follows existing command shape)
- `aigon-cli.js` — wire `bench-status` dispatch (already dispatches via misc.js pattern)
- `lib/opencode-cost.js` (new) — SQLite cost reader for op runs, or extend `lib/telemetry.js`
- `lib/bench-status.js` (new) — process scanner and table renderer

## Dependencies

- `sessions-close` command must work on a seed repo path (it does — it takes featureId and calls tmux kill). Verify with a dry-run test.
- `better-sqlite3` may need to be added to `package.json` devDependencies if not already present. Check first — `lib/telemetry.js` may already use it for the `opencode-db` strategy.

## Out of Scope

- Dashboard UI panel for benchmark history (separate feature).
- Scheduled/recurring benchmark runs (separate feature).
- Cost estimation before a run starts.
- Per-message cost breakdown (summary totals are sufficient).
- Cross-machine cost aggregation (local machine only).

## Open Questions

- Does `lib/telemetry.js` already read from the OpenCode SQLite DB for the `opencode-db` strategy? If yes, the cost capture may just need correct wiring rather than a new reader. Check `telemetryStrategy: "opencode-db"` handling before building `lib/opencode-cost.js`.
- Should `bench-status` also show the last N completed runs (most recent `all-*.json`)? Useful context but could be a follow-on.

## Related

- Set: agent-benchmarks
