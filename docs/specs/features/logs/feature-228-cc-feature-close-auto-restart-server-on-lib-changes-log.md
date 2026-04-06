# Implementation Log: Feature 228 - feature-close-auto-restart-server-on-lib-changes
Agent: cc

## Plan
Add a final phase to the `feature-close` orchestrator that detects whether
the merged commits touched any `lib/**/*.js` file and, if so, restarts the
running aigon server. Best-effort, never fatal. Wire it via the existing
phase chain in `lib/commands/feature.js` so the new logic lives entirely in
`lib/feature-close.js` (single owning module).

## Progress
- Added `restartServerIfLibChanged(target, deps)` to `lib/feature-close.js`.
  Pure function with all dependencies injected for testability — config,
  git diff, registry lookup, process check, restart callback, log + warn.
- Wired the new phase as Phase 12 (final) in the `feature-close` handler in
  `lib/commands/feature.js`. Catches any unexpected exception so the close
  is never failed by the restart phase. The injected `restartServer` shells
  out to `node aigon-cli.js server restart` so we reuse the existing
  restart code path (which already handles launchd/systemd vs in-process).
- Added a 10-line unit test at `tests/integration/feature-close-restart.test.js`
  covering AC1 (lib touched → restart), AC2 (no lib → skip), AC7 (no server
  → skip), AC8 (config opt-out → skip). Registered in `package.json` test
  script.
- Test budget verified at 2000/2000 LOC (exactly at ceiling).
- Full `npm test` suite passes (9 integration tests).
- Full `MOCK_DELAY=fast npm run test:ui` passes (8 e2e tests).

## Decisions
- **Function lives in `lib/feature-close.js`, not `lib/server-runtime.js`.**
  The spec sketch suggested using a `restartServer()` helper from
  `server-runtime`, but no such helper exists — the actual restart logic
  lives inline inside `lib/commands/infra.js` (handles launchd/systemd
  delegation, port killing, dashboard relaunch). Replicating it would
  duplicate ~80 lines and drift over time. Cleaner solution: shell out to
  `node aigon-cli.js server restart`, reusing the canonical code path.
  The shell-out is in the injected `restartServer` callback in
  `feature.js`, so tests still mock it cleanly.
- **Server-running check uses the proxy registry directly**, since
  `getServerRegistryEntry` is private to `infra.js`. The bridge in
  `feature.js` constructs an equivalent lookup using
  `loadProxyRegistry()` + `getAigonServerAppId()` from `lib/proxy.js`
  (both already exported).
- **Test mocks the diff via `runGit`** rather than building a real git
  history. The function trusts git's pathspec filter — production passes
  `-- 'lib/**/*.js'` so the result is pre-filtered. The test mocks
  `runGit` to return either lib paths or an empty string.
- **One integration test file, four assertions** to stay inside the 2000
  LOC test budget (was at 1990 before this feature). Used compact form
  per CLAUDE.md rule T3 — assertions still cover all four ACs explicitly.
- **Skip-on-error pattern** rather than try/catch on the whole phase: each
  failure mode (config opt-out, diff error, no server, restart error) has
  its own early-return so the warning text only fires on actual restart
  failures (per AC3).

## Notes
- Two UI tests appeared to fail on the first run because a parallel
  Playwright run from the feature-229 worktree was contending on port
  4119. Re-running after that worker finished produced 8/8 green.
</content>
