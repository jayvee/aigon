# Implementation Log: Feature 220 - server-reliability-hardening
Agent: cc

## Plan

Four small additive changes, implemented in the order suggested by the spec
(lowest risk first): AC2 → AC1 → AC3 → AC4. No rewrites of working code,
each AC independently testable, every change reversible.

## Progress

- **AC2 — sweepHealth**: added pure-derivation `sweepHealth` field to
  `getSupervisorStatus()` in `lib/supervisor.js`. Thresholds: < 90s healthy,
  < 5min stale, otherwise dead. `aigon server status` in `lib/commands/infra.js`
  reads it with a graceful fallback for older servers (just shows
  `Supervisor: running` without the badge if `sweepHealth` is missing).
  Smoke-tested via `node -e` — returns `dead` when never swept, as expected.

- **AC1 — SIGKILL fallback in `killPortHolder`**: kept the existing
  SIGTERM + 1s grace loop intact, then added a `stillAlive` flag. If still
  alive, log `[server] force-killing stale port holder PID <n>`, send SIGKILL,
  poll up to another 500ms. Re-checks `n !== process.pid` before escalating.
  If even SIGKILL fails (true zombie), falls through and lets the existing
  `server.listen()` EADDRINUSE handler take over — no throw, no extra error
  surface.

- **AC3 — post-restart health check**: new exported `waitForServerHealthy(port,
  timeoutMs=5000)` in `lib/server-runtime.js`. Probes
  `/api/supervisor/status` first (HTTP layer + supervisor subsystem alive),
  falls back to `/` (older servers). Both probes are 500ms-timeout-bounded so
  the helper can never hang past the deadline. Wired into both restart paths
  in `lib/commands/setup.js` (launchd/systemd path AND manual kill+respawn
  path) via a local `verifyHealth(port)` closure that uses the configured
  server port. Made the `update` command handler `async` so the awaits work;
  the dispatcher in `aigon-cli.js` already handles returned promises.
  Smoke-tested against port 1: returns false in ~1s for a 1s timeout.

- **AC4 — crash-loop backoff**:
  - macOS plist: added `<key>ThrottleInterval</key><integer>10</integer>`.
  - Linux systemd unit: bumped `RestartSec` from 5 to 10, added
    `StartLimitIntervalSec=60` + `StartLimitBurst=5` under `[Unit]` so systemd
    gives up after 5 rapid crashes within 60s instead of pinning a CPU core.
  - Existing installations are not auto-rewritten — users re-run
    `aigon server start --persistent` to pick up the new settings (the install
    flow already does an atomic unload+load).

- **Docs**: updated `site/content/reference/commands/infra/server.mdx`:
  - Added a "throttles crash loops" bullet to the persistent-mode feature list.
  - Added two new troubleshooting rows for crash-looping services and stale
    sweep health, plus a note on the new `aigon update` health-check output.

## Decisions

- **Pure derivation, no extra state for sweepHealth**: the spec called this
  out explicitly and it kept the change to ~10 lines with zero new I/O. The
  observe-only invariant from CLAUDE.md is preserved — `sweepHealth` is
  computed at read time from existing `lastSweepAt`.
- **Keep SIGKILL fallback inside the existing `try` scope**: the surrounding
  `catch (_)` swallows EPERM/ESRCH from `process.kill`, which is the
  desired "already dead" behavior. The new code uses an inner `try/catch` for
  the SIGKILL call so an unrelated kill error can't prevent the second poll
  loop from running.
- **Probe `/api/supervisor/status` first then fall back to `/`**: the spec
  said "stronger signal preferred". Falling back to `/` covers the case where
  the new server hasn't yet mounted the status route or the user is updating
  across versions.
- **Use `getConfiguredServerPort()` to discover the port for verification**:
  the port is centralised in `lib/config.js` and that's the same source the
  server uses to bind. Using the registry entry would have meant racing the
  restart (entry might be stale or missing while the new process boots).
- **Did NOT bump installed services automatically**: explicitly per the spec —
  rewriting an in-use plist/unit during `aigon update` is exactly the kind of
  surprise the safety principle exists to avoid. Users opt in via
  `aigon server start --persistent`.

## Validation

- `node -c` syntax check on every edited file: OK
- `npm test`: 13/13 workflow tests, 11/11 prompt-resolver tests, all green
- `getSupervisorStatus()` smoke test: returns `sweepHealth: 'dead'` when
  no sweep has happened
- `waitForServerHealthy(1, 1000)` smoke test: returns `false` in ~1020ms

## Manual Testing Checklist

After merging, verify each AC by hand from the main repo:

1. **AC2 — sweepHealth display**:
   1. `aigon server restart`
   2. Wait ~10 seconds
   3. `aigon server status` → expect `Supervisor: running 🟢 healthy`
   4. (Optional) Stop the supervisor sweep loop manually and re-run status
      after 90s → expect `🟡 stale`; after 5min → expect `🔴 dead`
2. **AC1 — SIGKILL fallback**:
   1. In one terminal: `nc -l 4100` (or `python3 -m http.server 4100`)
   2. In another terminal: `aigon server restart`
   3. Expect: `[server] force-killing stale port holder PID <n>` followed by a
      successful start (no EADDRINUSE)
3. **AC3 — post-restart health check via `aigon update`**:
   1. From the aigon repo: `aigon update`
   2. Expect: `🔄 Server restarted via system service.` followed within ~2-3s
      by `✅ Server restarted and responding on port 4100`
   3. Negative path: deliberately break a `lib/*.js` syntax error, run
      `aigon update` → expect the `⚠️` warning (and then revert the break)
4. **AC4 — launchd/systemd backoff**:
   1. `aigon server start --persistent` to install the new plist/unit
   2. macOS: `plutil -p ~/Library/LaunchAgents/com.aigon.server.plist | grep ThrottleInterval`
      → expect `10`
   3. Linux: `cat ~/.config/systemd/user/aigon-server.service | grep -E
      'RestartSec|StartLimit'` → expect `RestartSec=10`,
      `StartLimitIntervalSec=60`, `StartLimitBurst=5`
   4. (Optional) Inject a deliberate startup throw and confirm respawns are
      ≥10s apart in `~/.aigon/logs/server-stderr.log`

## Conversation Summary

User invoked `/aigon:feature-do 220` from inside the worktree with no prior
back-and-forth. I read the spec, confirmed the existing code in
`server-runtime.js`, `supervisor.js`, `supervisor-service.js`, `infra.js`, and
`setup.js`, and implemented the four ACs in the order the spec recommended.
No mid-flight scope changes or pushback.
