Token-usage axis + IMPLEMENTATION_RUBRIC_V1 judge wired into perf-bench (CLI flag `--judge`); `findCodexSessionFiles` now accepts `afterMs` cutoff; pro-bridge null-guard so test:ui boots without `@aigon/pro` installed.

## Code Review

**Reviewed by**: (Cursor / Composer)
**Date**: 2026-04-28

### Fixes Applied
- `f338e6f7` — `fix(review): wire afterMs for Codex bench telemetry; restore docs from main` — `captureAgentTelemetry` now passes `afterMs` into `parseCodexTranscripts` (perf-bench had been passing the option with no effect). Restored `docs/marketing/`, `docs/competitive/`, and two `02-backlog` specs to match `main` after out-of-scope deletions on the branch.

### Residual Issues
- **Primary telemetry path:** When `aggregateNormalizedTelemetryRecords` returns data first, `afterMs` is never applied (short-circuit before Codex fallback). Unchanged here — broader filter would need timestamp fields on normalized JSON records; Codex **fallback** is now correct per spec.
- **Normalized aggregate vs. bench window:** `readBenchmarkTelemetryUsage` / aggregate still sum all `feature-<id>-*.json` for the agent with no time filter if historical files linger; seed-reset + feature scope usually avoids this; document if operators hit double-counts.
- **`npm run test:iterate`:** Scoped run pulled Playwright (`templates/dashboard/styles.css` on the branch). Local e2e had multiple failures (brewboard fixture / duplicate feature-01 specs in logs); `node tests/integration/perf-bench.test.js` and `benchmark-judge.test.js` passed.

### Notes
- Implementation quality: `lib/benchmark-judge.js` rubric + `extractJsonObject` are solid; `perf-bench` CLI flags for `--judge` are wired in `lib/commands/misc.js`. Optional follow-up: thread `judge` through `runAllBenchmarks` is already spread via `...judgeOpts` in the loop — OK.
