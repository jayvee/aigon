# Feature: Agent Performance Benchmarks & Run-Time Optimization

## Summary

Build an automated performance benchmark that measures end-to-end agent run times on seed repos, and use it to identify and fix bottlenecks. The benchmark captures time from `feature-start` to `agent-status submitted`, broken down by phase (CLI overhead, worktree creation, agent startup, implementation, commit/signal). Results are stored as JSON for CI regression detection.

## User Stories

- [ ] As a developer, I can run `aigon perf-bench` to measure how long a seed feature takes end-to-end
- [ ] As a developer, I can see a phase-by-phase breakdown of where time is spent
- [ ] As a developer, I get a warning if a run regresses beyond the threshold vs the stored baseline

## Acceptance Criteria

- [ ] New CLI command `aigon perf-bench [seed-name]` that: resets a seed repo, starts a feature, waits for agent completion, records total time and per-phase durations
- [ ] **Bare baseline run**: before the aigon run, executes `claude -p` on the same seed repo with the same task (e.g. "add footer to page.tsx") — no aigon, no worktree, no slash commands. Records this as `barelineMs` for comparison
- [ ] **Aigon overhead** calculated as `totalMs - baselineMs` and reported prominently
- [ ] Phase breakdown captures at minimum: cli-start (workflow engine + git + worktree), agent-boot (CC startup + hook execution + context load), agent-work (spec read → code edit → commit), agent-signal (status submitted signal)
- [ ] Results written to `.aigon/benchmarks/{seed}-{feature}-{timestamp}.json` with structure: `{ seed, featureId, totalMs, baselineMs, overheadMs, phases: [...], model, aigonVersion }`
- [ ] Baseline file `.aigon/benchmarks/baseline.json` stores best-known times; `perf-bench --check` compares latest run against baseline and exits non-zero if regression > 20%
- [ ] `docs/agents/claude.md` and `development_workflow.md` trimmed for `rigor: "light"` repos (conditional sections like feature-do already done — extend to these files)
- [ ] Template placeholder `{{AGENT_DEV_SERVER_NOTE}}` resolved correctly (currently orphaned in some templates)

## Validation

```bash
node -c aigon-cli.js
node -c lib/config.js
node -c lib/commands/setup.js
```

## Technical Approach

**Benchmark harness** (`lib/commands/misc.js` or new `lib/perf-bench.js`):
1. Calls `seed-reset` to get a clean repo
2. Calls `feature-start` with a known trivial feature (e.g. brewboard #07 add-footer)
3. Polls the workflow snapshot for agent status = "submitted"
4. Captures timestamps at each phase boundary using `agent-status` event timestamps from the workflow event log
5. Writes JSON result

**Phase detection** — use existing workflow events:
- `feature.started` → CLI phase end
- First `signal.heartbeat` → agent-boot phase end
- `signal.agent_status_changed` (implementing) → agent-work start
- `signal.agent_status_changed` (submitted) → agent-work end
- Total = submitted.at - started.at

**Template optimization** — extend the `isLight` conditional pattern from `feature-do` to:
- `docs/agents/{agent}.md` templates — strip verbose sections for light rigor
- `docs/development_workflow.md` — strip Fleet/evaluation guidance for light
- Resolve orphaned `{{AGENT_DEV_SERVER_NOTE}}` placeholder

## Dependencies

- Seed repos (brewboard-seed) must have a trivial feature in backlog (already done: #07 add-footer)
- `seed-reset` must run `init` + `install-agent` (already fixed in this session)

## Out of Scope

- CI integration (GitHub Actions) — future feature
- Profiling Claude Code internals (out of our control)
- Optimizing non-seed production repos

## Open Questions

- Should the benchmark support multiple seed repos (brewboard + trailhead) or just one?
- Should we track model cost alongside time (token counts from telemetry)?

## Related

- This session's work: trimmed feature-do from 9.1KB → 4.7KB, fixed seed-reset
- Baseline: raw Claude Code = ~20s for footer task; aigon overhead target = <60s additional
