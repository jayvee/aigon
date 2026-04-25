---
complexity: high
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-25T13:29:41.041Z", actor: "cli/feature-prioritise" }
---

# Feature: Server-scheduled kickoff for features and research

## Summary

Let operators register **one-shot wall-clock jobs** that the **Aigon dashboard server** evaluates on a timer. When `runAt` is due, the server spawns the same CLI entrypoints used today for manual kickoff: **`feature-autonomous-start`** (with full flag parity for workflow shape) and **`research-start`** (research has no autonomous conductor; scheduled `research-start` is sufficient for phase 1). Jobs are stored in **durable repo-local state** under `.aigon/state/`, not in spec frontmatter, so specs stay clean and git diffs are not churned by scheduling.

Phase 1 is **manual only**: the operator chooses date and time per job. **No** integration with provider quotas, budget poller, or token-window.

## User Stories

- [ ] As an operator, I want to **add** a scheduled kickoff for a feature in autonomous mode (agents, stop-after, workflow slug, models/efforts, etc.) so it starts automatically while I sleep after a quota reset.
- [ ] As an operator, I want to **add** a scheduled **`research-start`** for a research topic so Fleet/Drive sessions open at a chosen time without clicking the dashboard.
- [ ] As an operator, I want to **list** and **cancel** pending jobs without editing JSON by hand.
- [ ] As an operator, I want `runAt` stored with an **unambiguous timezone** (ISO 8601 offset) so “1:10 after reset” means what I think it means.
- [ ] As an operator, I want **idempotent firing**: if the server restarts around `runAt`, I do not get duplicate tmux / duplicate `feature-autonomous-start` for the same job.

## Acceptance Criteria

### Data model and storage

- [ ] Canonical job store lives under `.aigon/state/` (exact filename or `scheduled-kickoffs/*.json` is an implementation detail). Jobs are **per repo** (path keyed the same way multi-repo registration resolves `repoPath`).
- [ ] Each job has at minimum: stable **`jobId`** (uuid or monotonic id), **`runAt`** (ISO 8601 string with offset), **`kind`** ∈ `{ feature_autonomous, research_start }`, **`entityId`** (numeric string), **`repoPath`** (absolute, normalised), **`payload`** (kind-specific arguments mirroring CLI), **`createdAt`**, and lifecycle fields **`status`** ∈ `{ pending, fired, cancelled, failed }` with optional **`firedAt`**, **`error`** (last failure message), **`cancelledAt`**.
- [ ] **`feature_autonomous` payload** must round-trip the same argument surface the dashboard already builds for autonomous start: agents list, optional eval/review agents, `stopAfter`, optional `workflow` slug, optional `models` / `efforts` CSV strings matching existing validation in `lib/dashboard-routes.js` (reuse validation helpers where practical — do not fork divergent rules).
- [ ] **`research_start` payload** must carry `agents` (possibly empty for default behaviour — match whatever `research-start` allows today) and any flags already supported by `research-start` in phase 1 (minimum: numeric id + agent list if required by CLI).
- [ ] **No** spec frontmatter keys are required for phase 1; optional cross-link in docs only.

### Server behaviour

- [ ] When **`aigon server`** is running for a repo root that contains pending jobs (or registered multi-repo paths), a **poller** runs at a bounded interval (e.g. 30–60s, configurable constant) and loads jobs whose `status === 'pending'` and `runAt <= now` (compare in UTC or with a single consistent library — document the rule).
- [ ] For each due job, the server **claims** the job before spawn (e.g. transition `pending` → `firing` atomically or write-with-lock under `.aigon/state/`) so two server processes or a restart mid-flight does not double-execute.
- [ ] Successful spawn: invoke the existing pattern used elsewhere — **`spawn`** or **`spawnSync`** of `process.execPath` + `aigon-cli.js` + argv, **`cwd`** = job `repoPath`, same env hygiene as dashboard action dispatch (e.g. `GIT_TERMINAL_PROMPT=0`). On non-zero exit or spawn error, record **`failed`** with stderr snippet (truncated), do not infinite-retry the same job unless operator resets (explicit `aigon schedule retry` is optional — **out of scope** unless trivial).
- [ ] If the server is **not running** at `runAt`, the job remains **pending** until the server next runs (document as limitation for phase 1). **No** “catch-up backlog” policy beyond “fire once when next eligible” unless specified in Open Questions.

### CLI

- [ ] New command group under misc or dedicated module, e.g. **`aigon schedule add|list|cancel`** (exact spelling in `lib/templates.js` + `COMMAND_REGISTRY`).
- [ ] **`schedule add`**: accepts kind, entity id, `runAt`, repo override if needed, and kind-specific options (flags or JSON file path — pick one approach and document). Validates entity exists in workflow + folder expectations where the target commands already validate.
- [ ] **`schedule list`**: prints pending (and optionally fired/cancelled) jobs sorted by `runAt`.
- [ ] **`schedule cancel|rm`**: marks job `cancelled` by `jobId`; no-op or error if already fired.

### Security and ergonomics

- [ ] Scheduled execution is **local-trust** only (same machine as server). No new unauthenticated HTTP surface that enqueues jobs from the network unless existing dashboard auth already covers action dispatch; if dashboard gains “schedule from UI” later, it must reuse the same store and validation. **Phase 1** can be **CLI-only**; dashboard UI is optional follow-up.

### Testing

- [ ] Unit or integration tests with **injected clock** and **mocked spawn** prove: (1) due job fires once, (2) cancelled job never fires, (3) claim prevents double fire, (4) invalid payload rejected at `schedule add`.
- [ ] **`node --check`** on touched entry files; **`npm test`** passes.

## Validation

```bash
node --check aigon-cli.js
npm test
```

## Pre-authorised

- May ship **CLI-only** in phase 1 with **no** dashboard HTML changes; optional thin API for later UI does not block merge if unused.
- May add a **versioned migration** under `lib/migration.js` only if an existing on-disk layout needs a one-time rename; greenfield `scheduled-kickoffs.json` may ship without migration.
- May raise `scripts/check-test-budget.sh` default **CEILING** after deleting duplicate `tests/commands/token-window.test.js` (integration harness remains canonical), so `bash scripts/check-test-budget.sh` matches the current `tests/**/*.js` tree size.

## Technical Approach

- **Owner module**: new `lib/scheduled-kickoff.js` (or similar) owning schema validation, read/write with existing atomic write helpers (`safeWrite` / patterns from `agent-status.js`), and “due jobs” query. **Poller** starts from `lib/dashboard-server.js` (or supervisor bootstrap) only when server is up; use `setInterval` with `.unref()` where appropriate so tests/CLI do not hang.
- **Spawn argv builder**: factor or reuse pieces from `lib/dashboard-routes.js` autonomous-start branch so CLI flags and dashboard stay aligned (grep discipline per AGENTS.md write-path contract).
- **Locking**: reuse exclusive file lock patterns from workflow-core or state writes if concurrent server instances are a concern; minimum is atomic read-modify-write on a single queue file or per-job file in a directory.
- **Research**: default `kind=research_start`; document that **`research-autopilot`** is out of scope for phase 1 (Pro gate and different lifecycle).

## Dependencies

- None — standalone enhancement.

## Out of Scope (phase 1)

- Quota / budget / token-window integration or “smart” delay until quota refills.
- Recurring schedules (cron expressions), snooze, or timezone pickers in UI.
- **`research-autopilot`** as a scheduled kind.
- Email/push notifications when a job fires or fails.
- Running scheduled jobs when **no** Aigon server process is active (operator uses OS cron + `aigon feature-autonomous-start` instead).

## Open Questions

- **Missed window**: if `runAt` was 01:10 and server starts at 03:00, should the job fire immediately once (implicit catch-up) or be marked `skipped` / require operator action? **Default proposal:** fire once on next poll if still `pending` and `runAt <= now` (simple catch-up); document in help text.
- **Multi-repo**: confirm whether one server process loads schedules from **all registered repo roots** or only `process.cwd()` — AC assumes per-`repoPath` jobs and registration check identical to dashboard action dispatch.

## Related

- Prior design discussion: server-owned schedule store, parity with `feature-autonomous-start` / `research-start` CLI.
- Analogue pattern: external cron + `aigon token-window` (F352) — complementary, not replaced.
