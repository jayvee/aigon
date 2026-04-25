---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-25T07:01:22.075Z", actor: "cli/feature-prioritise" }
---

# Feature: doctor-runs-pending-schema-migrations

## Summary

`aigon doctor --fix` is the documented escape hatch the engine cites whenever a read path encounters bad shape: when a row carries `MISSING_MIGRATION` (`lib/workflow-read-model.js:29,150`), when a snapshot is missing and the read model degrades to `MISSING_SNAPSHOT` (`lib/commands/setup.js:3293`), and in CLI errors that cite repair (`Run \`aigon doctor --fix\` to migrate`). Today `doctor --fix` does **state reconciliation and snapshot bootstrapping only** — it does **not** run registered schema migrations. Schema migrations (`lib/migration.js registerMigration(...)`) only run from two callers: `aigon install-agent` and `aigon check-version` — and `check-version` (`lib/commands/setup.js:1743`) is gated on `currentVersion !== installedVersion`, so when CLI and repo are at the same recorded version, no migration ever runs even if newer migrations are registered.

Consequence: a producer/repair gap. The read model correctly tags a row `MISSING_MIGRATION`; the CLI correctly cites `aigon doctor --fix`; the user runs it; nothing migrates; the row keeps misrendering. Caught in the wild on 2026-04-25 — `~/src/diviner` had pre-F341 snapshots (sidecar `specReview` on `lifecycle: backlog`) that should have transitioned to `spec_review_in_progress` via migration 2.56.0, but neither `doctor --fix` nor `check-version` would fire it because both versions matched at 2.54.6. Required a manual `runPendingMigrations` invocation to repair.

This feature wires registered schema migrations into the `doctor --fix` execution path. The migration framework is already idempotent (`lib/migration.js:236–239` — per-version manifest check skips already-applied migrations), so this is a small, low-risk addition to an existing producer.

## User Stories

- [ ] As a user, when the dashboard or CLI tells me to run `aigon doctor --fix` because of a `MISSING_MIGRATION` tag, the command actually applies the migration that's missing — not just a state reconciliation.
- [ ] As a user with a repo where CLI version equals recorded repo version (no upgrade pending), I can still apply schema migrations registered for newer versions by running `doctor --fix`. I shouldn't have to bump versions or run `install-agent` to unstick a stale snapshot.
- [ ] As a maintainer adding a new schema migration via `registerMigration('X.Y.Z', …)`, I can rely on `doctor --fix` as the single front-door repair command — without separately wiring my migration into a third caller.

## Acceptance Criteria

- [ ] `aigon doctor --fix` calls `runPendingMigrations(process.cwd())` and reports per-migration status in its output (e.g. `🔧 Migration 2.56.0: applied (3 snapshot(s) rewritten)` or `Migration 2.56.0: already applied (skipped)`).
- [ ] `aigon doctor` (without `--fix`) **detects** pending migrations and lists them as a "needs fix" item, but does **not** apply them — consistent with how the rest of `doctor` separates detect vs. apply.
- [ ] The new path is **idempotent**. Running `doctor --fix` twice in a row reports "already applied" the second time. Verified by repeating in the test.
- [ ] The new path is **safe under no-op**. If no migrations are registered or all are already applied, no errors, no log spam — single `✅ All migrations applied` line at most.
- [ ] On migration failure, `doctor --fix` does **not** abort the rest of its checks. The migration framework already produces a backup in `.aigon/migrations/<version>/` on failure (`lib/migration.js:247–263`); doctor surfaces the failure and points at the manifest path.
- [ ] Existing migration callers (`install-agent` at `lib/commands/setup.js:956`, `check-version` at `lib/commands/setup.js:1751`) are **unchanged**. They keep their version-gated behaviour. Doctor becomes a third, gate-free caller.
- [ ] **Regression test (new):** `tests/integration/doctor-runs-migrations.test.js` constructs a temp repo with a snapshot in pre-F341 shape (specReview sidecar on `lifecycle: backlog`), runs the `doctor --fix` code path, asserts the snapshot is rewritten to `spec_review_in_progress`, and asserts a second invocation skips cleanly.
- [ ] **Drift-prevention assertion:** the test for the read model's `MISSING_MIGRATION` detection (or a new test) asserts that for every input shape that produces `MISSING_MIGRATION`, there exists at least one registered migration that would resolve it. Prevents future read-model tags from being added without a corresponding producer.
- [ ] `npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh` passes.
- [ ] `node -c aigon-cli.js` passes; `aigon server restart` after `lib/*.js` edits.

## Validation

```bash
node -c aigon-cli.js
node tests/integration/doctor-runs-migrations.test.js
```

## Pre-authorised

- May raise `scripts/check-test-budget.sh` CEILING by up to +60 LOC for the new regression test (it needs a temp-dir fixture with a pre-F341 snapshot).
- May skip `npm run test:ui` — this feature touches `lib/commands/setup.js` and `tests/integration/` only, no dashboard assets.

## Technical Approach

### Current state — exact code references

- **Migrations registered**: `lib/migration.js:459 registerMigration('2.52.1', …)`, `lib/migration.js:476 registerMigration('2.56.0', …)`, `lib/migration.js:537 registerMigration('2.55.0', …)`.
- **Migration runner**: `lib/migration.js:352 runPendingMigrations(repoPath, fromVersion)` — sorts, filters by `fromVersion` (skip-or-equal), calls `runMigration` per entry.
- **Idempotency**: `lib/migration.js:234–239 runMigration()` — short-circuits if `readManifest(repoPath, version)` returns `status: 'success'`. The per-version manifest at `.aigon/migrations/<version>/manifest.json` is the source of truth for "already applied", **not** the `.aigon/version` file. So calling `runPendingMigrations(repoPath)` with **no `fromVersion`** is safe — already-applied migrations skip themselves.
- **Producer-tag for the missing-migration case**: `lib/workflow-read-model.js:164 detectMissingMigration(snapshot)` — fires on sidecar `specReview` + `currentSpecState ∈ {inbox, backlog}` + (`activeReviewers > 0` OR `pendingCount > 0`).
- **Existing callers**:
  - `lib/commands/setup.js:956–957` — `install-agent` calls `runPendingMigrations(process.cwd())` with no fromVersion.
  - `lib/commands/setup.js:1751–1752` — `check-version` calls `runPendingMigrations(process.cwd(), installedVersion)`. **Gated** on `currentVersion !== installedVersion` (line 1743). When versions match, the entire branch is skipped, including the migration call.
- **Doctor handler**: `lib/commands/setup.js:2139 'doctor': (args) => { … }` — body runs through ~1500 lines of checks; relevant landmarks include the workflow-state bootstrap at `:3275–3293` and the log-flatten migration at `:3155–3203` (a one-off, not the schema migration runner).

### Design

Add a single check block to the `doctor` handler that:

1. Imports `runPendingMigrations` lazily (matches the existing pattern at `:956,1751`).
2. Calls `runPendingMigrations(process.cwd())` with **no `fromVersion`** (idempotent, no-op when up-to-date).
3. Renders results via the existing per-result shape (`{ version, status }`) — one line each.
4. Treats `failed` / `restored` results as a doctor "needs attention" item but does not abort.
5. In **detect-only** mode (`doctor` without `--fix`): pre-walk the registry vs. on-disk manifests to report "N pending migration(s)" without calling the runner. Point at `aigon doctor --fix` as the apply step.

Placement: before the workflow-state bootstrap step (`:3275`), so by the time bootstrap runs, schema-shape concerns are already resolved. Bootstrap is a second-line repair (creating brand-new snapshots); migrations rewrite existing snapshots. Migrations must run first.

### Why not just bump `check-version`'s gate

Tempting alternative: drop the `currentVersion !== installedVersion` gate so `check-version` always runs migrations. Rejected because:
- The gate exists to skip the heavy `update` flow when nothing changed; running migrations is the smaller piece, but the rest of the branch (CLI sync, template regenerate) is not idempotent enough to run on every `check-version`.
- `check-version` runs implicitly on a lot of paths (every `aigon` invocation in some setups). Doctor is the explicit "apply repairs" command; that's the right semantic home.

### Why not call from the read-model tag site

Read paths must not mutate. `lib/workflow-read-model.js detectMissingMigration` correctly *flags* the issue. Mutating from the read path would violate the dashboard read-only rule (`AGENTS.md:133`). Doctor is the correct producer-side repair surface.

### Files to edit

1. `lib/commands/setup.js` — add the migrations-runner block to the `doctor` handler (`:2139` body). Both `--fix` (apply) and detect-only modes.
2. `tests/integration/doctor-runs-migrations.test.js` (new) — temp-repo fixture with pre-F341 snapshot, run doctor --fix code path, assert post-state and idempotency.
3. Optional: `lib/workflow-read-model.js` — add a small `getRepairableMissingMigrationVersions()` helper if the drift-prevention assertion needs it. Keep optional; only if it makes the test cleaner.
4. `AGENTS.md` Reading-order section §5 (or the F296/F341 paragraph at `:16`) — one line documenting that `doctor --fix` now runs schema migrations as the single front-door repair.

### Test-fixture shape

`tests/integration/doctor-runs-migrations.test.js`:

```text
1. mkdtemp; init `.aigon/workflows/features/77/snapshot.json`
   with { lifecycle: 'backlog', currentSpecState: 'backlog',
          specReview: { activeReviewers: [{ agentId: 'gg', startedAt: <t> }] } }
2. extract the doctor handler from setup.js (require + commands.doctor)
3. run with ['--fix']
4. assert snapshot rewritten to lifecycle: 'spec_review_in_progress'
5. run again
6. assert snapshot unchanged AND migration runner reported "skipped"
```

Tests must NOT use the global `~/.aigon` paths — set `process.cwd()` (or pass repoPath through ctx where the doctor handler accepts overrides) to the temp repo. Sibling test patterns: `tests/integration/global-config-migration.test.js`.

## Dependencies

- None on the producer side; the migration runner already exists. Test depends on the established `withTempDirAsync` pattern in `tests/_helpers.js`.

## Out of Scope

- **Changing the migration framework itself** (registry shape, per-version log format, backup mechanism). It already does what it needs to. This feature only wires a third caller.
- **Auto-running migrations on every `aigon` invocation.** Explicitly opt-in via `doctor --fix`; do not bolt onto every command.
- **Migrating snapshots that the read model does not flag.** Only run registered migrations; do not invent new ones.
- **Cross-machine sync of migration state.** `lib/sync.js` is a separate concern.
- **Making `check-version` ungated.** See "Why not" above.
- **A new event log entry for migration application.** Migrations are framework-level, not engine-level events. The per-version manifest in `.aigon/migrations/<version>/` is the audit trail.

## Open Questions

- Should `doctor --fix` always invoke `runPendingMigrations`, or only when the read-model walk finds at least one `MISSING_MIGRATION` row? Current lean: **always invoke** — the framework's idempotency makes it a near-zero-cost no-op when nothing's pending, and gating on read-model tags means a future migration that doesn't have a read-model tag yet would never get applied. Decide during impl.
- Should the detect-only mode (`doctor` without `--fix`) also include "N migrations pending" in its summary line counts at the bottom of the doctor output? Current lean: yes — it's the same shape as the existing "needs fix" items.
- Does running migrations from doctor risk overlapping with a concurrent `install-agent` or `check-version` invocation that also calls the runner? The runner uses per-version manifests as locks; the second caller will see `success` and skip. No race risk on success. On failure, both might race on backup; investigate during impl whether to add a coarse file lock at the migrations root.

## Related

- Set: standalone
- Closely related to F341 (introduced `MISSING_MIGRATION` and migration 2.56.0) and F296 (closed the `feature-create` snapshot-bootstrap gap with shared write-path helpers). Same pattern: producer must catch up to read-model expectations.
- Pairs naturally with future feature: extend `aigon doctor` to also run **global config migrations** (`lib/global-config-migration.js`) — currently only `aigon update` triggers them. Out of scope for this spec; worth its own.
