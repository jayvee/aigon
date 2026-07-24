---
aigon_id: F693
complexity: very-high
agent: cc
set: pro-merge
---

# Feature: merge aigon-pro into aigon oss

## Summary

Dissolve the OSS/Pro split created on 2026-04-07 and fold the entire `~/src/aigon-pro`
codebase, test suite, and (sanitised) spec history back into the public `aigon` repo.
Aigon becomes a single free, open-source product with no commercial tier: Insights,
Aigon Sync, Vault/Backup, Profile Sync, Scheduled Kickoffs, Recurring Features, the
Benchmark Matrix, and Agent Failover all ship to every user with no key, no gate, and
no "PRO" badge. The whole gating apparatus — `lib/pro.js`, `lib/pro-bridge.js`, the
hardcoded beta key, `aigon pro activate|status`, `AIGON_FORCE_PRO`, the four dashboard
stub modules, and every `proBadge` — is deleted rather than defaulted-on. The
`aigon-pro` GitHub repo survives as a **private archive** for marketing, competitive
analysis, and the beta-tester roster; it stops being an installable package.

This is a large, mechanical-but-judgment-heavy migration across three axes: **code**,
**tests**, and **specs**. The spec history axis is the risky one — 148 markdown files
carry feature IDs that collide with existing OSS features, and some carry commercial or
private framing that must not appear in a public repo.

## User Stories

- [ ] As an Aigon user, I run `aigon insights`, `aigon vault push`, `aigon schedule add`
      and `aigon recurring list` on a plain `npm i -g @senlabsai/aigon` install and they
      all work — no separate package, no key, no "Pro feature — coming later" notice.
- [ ] As an Aigon user, I open the dashboard and see Insights as a real tab, Aigon Sync
      and Schedule as ordinary Settings sections, and the Benchmark Matrix rendering —
      with no `PRO` superscript badges anywhere.
- [ ] As an existing beta tester with `proKey` in `~/.aigon/config.json`, my install keeps
      working after upgrading; the stale key is ignored (and cleaned up by `aigon doctor --fix`)
      rather than causing an error.
- [ ] As a maintainer, `git log` and `aigon feature-spec <ID>` resolve the design history
      of Insights (F114), the Pro extension seam (F219), Sync (F700), Vault (F704) and
      Failover (F706) inside the OSS repo — I never have to open a second repo to find
      out why an engine works the way it does.
- [ ] As a maintainer, no imported spec, log, or eval file in the public repo contains a
      beta key, a beta tester's name or email, pricing figures, revenue projections, or
      licensing/checkout planning.
- [ ] As a maintainer, `aigon feature-create` after the merge allocates 720+ and never
      re-issues an imported ID.

## Acceptance Criteria

### Code merge

- [ ] `lib/insights.js`, `lib/benchmark-artifacts.js`, `lib/sync.js`, `lib/sync-core.js`,
      `lib/sync-merge.js`, `lib/sync-state.js`, `lib/backup.js`, `lib/recurring.js`,
      `lib/scheduled-kickoff.js`, `lib/profile-state.js`, `lib/agent-failover.js`, and
      `lib/cron-parse.js` exist in the OSS repo with their aigon-pro content and pass lint.
- [ ] The eight aigon-pro re-export shims (`lib/agent-registry.js`, `lib/cli-parse.js`,
      `lib/config.js`, `lib/spec-crud.js`, `lib/workflow-core/engine.js`,
      `lib/workflow-snapshot-adapter.js`, `lib/feature-spec-resolver.js`,
      `lib/feature-autonomous-payload.js`) are **not** imported; every
      `require('@senlabsai/aigon/lib/…')` in migrated code becomes a relative require.
- [ ] `grep -rn "@senlabsai/aigon-pro\|@aigon/pro" lib/ templates/ aigon-cli.js scripts/ site/`
      returns no hits outside historical spec/log prose.
- [ ] `node scripts/check-module-graph.js` passes — no new require cycles, and any new
      boundary violation is either avoided or justified in `scripts/module-graph-baseline.json`.

### Gating removal

- [ ] `lib/pro.js`, `lib/pro-bridge.js`, `lib/dashboard-pro-assets.js`,
      `lib/commands/pro.js`, and `templates/dashboard/stubs/` are deleted.
- [ ] The `aigon pro`, `aigon pro activate`, and `aigon pro status` verbs are removed from
      the CLI dispatch and print nothing; `aigon help` no longer lists them.
- [ ] `AIGON_FORCE_PRO` is not read anywhere in the codebase.
- [ ] No literal or base64 beta key exists in the repo:
      `grep -rn "thunder-cedar-hollow\|dGh1bmRlci1jZWRhci1ob2xsb3c" .` returns nothing
      outside `.git/`.
- [ ] The thin delegating stubs in `lib/commands/recurring.js`, `lib/commands/schedule.js`,
      and `lib/commands/agent-launch.js` are replaced by the real aigon-pro implementations
      from `aigon-pro/commands/*.js`; no "Pro feature — coming later" string remains in `lib/`.
- [ ] `lib/board.js` calls `isFeatureSuspended` directly instead of probing `getPro()`.
- [ ] `lib/commands/setup/doctor.js` reports no Pro checks and, under `--fix`, removes a
      stale `proKey` from `~/.aigon/config.json`.
- [ ] `lib/onboarding/wizard.js` — **owned by F695**, not this feature. This feature must not
      leave the wizard broken in the interim: if `lib/pro.js` is deleted before F695 lands, the
      wizard's `require('../pro')` in the vault step breaks. Land F695 in the same series, or
      stub the vault step's Pro probe as part of commit 3.
- [ ] `lib/supervisor.js` `registerExhaustionHandler` and `lib/workflow-read-model.js`
      `registerFailoverActionAppender` either become direct calls into `lib/agent-failover.js`
      or keep their registration shape with the in-repo module as the sole registrant —
      whichever leaves fewer moving parts. Document the choice in the implementation log.

### Dashboard merge

- [ ] `aigon-pro/dashboard/{insights-dashboard,benchmark-matrix,backup-sync,scheduled-features,failover-dashboard}.js`
      land under `templates/dashboard/js/` as real ES modules registered in
      `js/view-registry.js` where they are views, imported directly by `js/settings.js` /
      `js/logs.js` where they are panels. No `Object.assign(globalThis, …)` survives, and no
      `typeof globalThis.<export> === 'function'` guards remain at their call sites.
- [ ] Any CSS extracted from those modules lives in `templates/dashboard/styles/` and is
      listed in `styles/manifest.json`.
- [ ] The `settings-pro-badge` CSS class and every `proBadge: true` option are removed;
      the "Aigon Sync" and "Schedule" Settings sections render without a badge and without
      the "(Pro)" parentheticals in their descriptions.
- [ ] The 14 routes aigon-pro registered via `pro-bridge` are registered in the OSS route
      table (`lib/dashboard-routes/`): `GET /api/insights`, `POST /api/insights/refresh`,
      `POST /api/feature-failover`, `GET /api/benchmarks/latest`, `GET /api/profile/status`,
      `GET /api/settings-sync/status`, `GET /api/backup/status`, `POST /api/backup/schedule`,
      `GET /api/sync/status`, `GET /api/recurring/status`, `GET /api/schedule/jobs`,
      `POST /api/schedule/add`, `POST /api/schedule/cancel`.
- [ ] `npm run test:browser` passes, and a Playwright/MCP snapshot confirms the Insights tab
      and the Benchmark Matrix render with real data (per CLAUDE.md hot rule 4 — snapshot via
      `aigon preview 693`, never the primary `aigon.localhost`).

### Server-side background work

- [ ] The scheduled-kickoff poller and the hourly vault-backup tick that aigon-pro's
      `register()` started at server boot now start unconditionally from the OSS server
      startup path, with the same intervals and the same `.unref()` behaviour.
- [ ] Recurring-feature batch creation at server start (8 types, weekly) runs for all users.

### Test merge

- [ ] `insights.test.js`, `benchmark-artifacts.test.js`, `backup.test.js`, and
      `scheduled-kickoff.test.js` land in `tests/unit/` and run under `npm run test:unit`.
- [ ] `agent-failover-end-to-end.test.js` from aigon-pro is reconciled with the OSS file of
      the same name at `tests/integration/agent-failover-end-to-end.test.js` — one merged
      file, no duplicated coverage, still on the `test:integration:heavy` list.
- [ ] `beta-key-validation.test.js` is **deleted**, not ported.
- [ ] `bash scripts/check-test-budget.sh` passes; if the imported tests push the budget over,
      raise the budget in the same commit with a one-line justification rather than skipping tests.
- [ ] `npm run test:deploy` is green.

### Spec history import

- [ ] All 13 pre-split features are restored at their **original** IDs (114, 115, 118, 122,
      123, 152, 153, 159, 211, 219, 221, 222, 226) in `docs/specs/features/05-done/`.
- [ ] All colliding features are renumbered per the mapping table below and their filenames,
      `aigon_id:` frontmatter, log filenames, eval filenames, and `.aigon/workflows/features/<id>/`
      directories all agree.
- [ ] Research 13, 15, 23 restored at original IDs; research 24, 25, 26 renumbered to 65, 66, 67.
- [ ] `feature-232-aigon-pro-split-marker.md` is **not** imported (it exists only to hold a
      counter floor that no longer means anything).
- [ ] `docs/specs/features/MOVED-TO-AIGON-PRO.md` is replaced by
      `docs/specs/features/MERGED-FROM-AIGON-PRO.md` carrying the full old→new ID mapping.
- [ ] Every cross-reference inside imported specs and logs (`F421`, `feature 236`, `research 15`, …)
      is rewritten to the new number, or left alone with a `(pre-merge aigon-pro ID)` annotation
      where rewriting would falsify a quoted commit message.
- [ ] `.aigon/state/identity-sequences.json` is seeded to `feature.next = 722`,
      `research.next = 68`.
- [ ] `aigon doctor` reports zero snapshotless specs and zero orphaned workflow dirs after import.
- [ ] `aigon feature-list` and `aigon board` render without error and show no duplicate IDs.

### Sanitisation

- [ ] No imported file contains: a beta key, a beta tester name or email address, pricing or
      revenue figures, licensing/checkout vendor evaluation, or "not yet available for purchase"
      style commercial framing.
- [ ] `grep -rIE '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}' docs/specs/` returns only the
      maintainer's own address or none at all.
- [ ] The pre-commit sensitive-content guard (`.githooks/pre-commit`) passes on the merge commit
      without `--no-verify`.

### Docs — this feature's share only

User-facing documentation (README, CONTRIBUTING, AGENTS.md, the docs site, `templates/help.txt`,
`docker/`) is **owned by F694**. This feature owns only the two artefacts it creates and the
archive repo's own orientation:

- [ ] `docs/specs/features/MERGED-FROM-AIGON-PRO.md` exists with the full old→new ID mapping,
      replacing `MOVED-TO-AIGON-PRO.md`.
- [ ] `docs/architecture.md` § "Aigon Pro (`@aigon/pro`)" is replaced by a section documenting the
      merged engines (Insights, Sync, Vault, Scheduling, Recurring, Benchmarks, Failover) and their
      modules; the module map gains the 12 new `lib/` files. **Shared with F694** — F694 owns the
      prose framing, this feature owns the module facts. Whichever lands second reconciles.
- [ ] `~/src/aigon-pro` `AGENTS.md` is updated to say the repo is a private archive: no code, no
      specs, no installs; marketing/competitive/roster content only.
- [ ] This feature does **not** edit `README.md`, `CONTRIBUTING.md`, `AGENTS.md`,
      `templates/help.txt`, `site/`, or `docker/` — leaving them stale for the duration of the
      set is expected and is F694's job to fix.

## Validation

```bash
# Boundary is gone
# NOTE: site/, README, CONTRIBUTING, AGENTS.md and templates/help.txt are F694's scope —
# they are deliberately NOT checked here and will still mention Pro when this feature closes.
! grep -rn "@senlabsai/aigon-pro\|@aigon/pro\|AIGON_FORCE_PRO\|isProAvailable\|assertProCapability" lib/ aigon-cli.js scripts/ templates/dashboard/
# Beta key: exclude this spec itself, which quotes the sentinel.
! grep -rn --exclude='feature-693-*' "thunder-cedar-hollow\|dGh1bmRlci1jZWRhci1ob2xsb3c" lib/ tests/ templates/ scripts/ docs/
! test -e lib/pro.js && ! test -e lib/pro-bridge.js && ! test -e templates/dashboard/stubs

# Engines are present and loadable
node -e "for (const m of ['insights','sync','backup','recurring','scheduled-kickoff','profile-state','agent-failover','benchmark-artifacts','cron-parse','sync-core','sync-merge','sync-state']) require('./lib/'+m)"

# Lifecycle state is coherent after the spec import
node aigon-cli.js doctor
node aigon-cli.js feature-list >/dev/null
node aigon-cli.js board >/dev/null

# No duplicate feature IDs across stage folders
test "$(ls docs/specs/features/0*/ | grep -oE '^feature-[0-9]+' | sort | uniq -d | wc -l)" -eq 0

npm run test:core
```

## Pre-authorised

- May run `git mv`, `git rm`, and bulk `sed` rewrites across `docs/specs/**` as part of the spec import, provided every move is followed by `aigon doctor` reconciliation in the same commit
- May raise the ceiling in `scripts/check-test-budget.sh` to accommodate the five imported test files
- May add a justified entry to `scripts/module-graph-baseline.json` for the merged engine modules
- May skip `npm run test:browser` mid-iteration; the deploy gate still runs it before close

## Technical Approach

### Phasing — do this in six commits, in this order

The merge is too large for one commit and the spec-history phase is the only irreversible
part. Order matters: get code green before touching specs, so a spec-import mistake can be
reverted without unwinding the code merge.

| # | Commit | Scope |
|---|--------|-------|
| 1 | `feat: vendor aigon-pro engines into lib/` | 12 lib files + relative-require rewrite. Nothing wired yet. |
| 2 | `feat: register merged engines in CLI, server, dashboard` | Route table, CLI verbs, server boot hooks, dashboard modules. Product works end-to-end. |
| 3 | `refactor: delete Pro gating apparatus` | pro.js, pro-bridge.js, stubs, badges, `aigon pro`, wizard step, doctor checks, board probe. |
| 4 | `test: merge aigon-pro test suite` | 5 test files, failover reconciliation, budget bump. |
| 5 | `docs: import and sanitise aigon-pro spec history` | The 148 markdown files, renumbering, workflow dirs, sequences seed, MERGED-FROM file. |
| 6 | `docs: record the merge in architecture.md and the archive repo` | `docs/architecture.md` module map, `MERGED-FROM-AIGON-PRO.md`, aigon-pro `AGENTS.md`. |

Run `npm run test:iterate` after each; `npm run test:deploy` before close.

User-facing docs (README, CONTRIBUTING, AGENTS.md, site/, `templates/help.txt`, `docker/`) are
**F694**; the setup wizard is **F695**. Both land after this feature. Expect the repo to
briefly describe a Pro tier that no longer exists — that is the intended intermediate state,
not a defect to fix here.

### Source inventory (what actually exists in aigon-pro)

**Engines (5,367 LOC across 12 real files; the other 8 `lib/` files are re-export shims to delete):**

| File | LOC | Becomes |
|---|---|---|
| `lib/sync.js` | 907 | `lib/sync.js` |
| `lib/backup.js` | 783 | `lib/backup.js` (exported as `vault` alias in Pro — keep both names) |
| `lib/scheduled-kickoff.js` | 674 | `lib/scheduled-kickoff.js` |
| `lib/insights.js` | 497 | `lib/insights.js` |
| `lib/sync-state.js` | 427 | `lib/sync-state.js` |
| `lib/profile-state.js` | 415 | `lib/profile-state.js` |
| `lib/recurring.js` | 406 | `lib/recurring.js` |
| `lib/sync-merge.js` | 336 | `lib/sync-merge.js` |
| `lib/benchmark-artifacts.js` | 335 | `lib/benchmark-artifacts.js` |
| `lib/agent-failover.js` | 281 | `lib/agent-failover.js` |
| `lib/sync-core.js` | 178 | `lib/sync-core.js` |
| `lib/cron-parse.js` | 110 | `lib/cron-parse.js` |

**Dashboard (1,924 LOC):** `benchmark-matrix.js` (828), `insights-dashboard.js` (828),
`backup-sync.js` (132), `scheduled-features.js` (103), `failover-dashboard.js` (33).

**Commands (416 LOC):** `commands/schedule.js` (212), `commands/agent-launch.js` (130),
`commands/recurring.js` (74), plus `commands/insights.md`.

**Tests (1,091 LOC):** `backup.test.js` (232), `insights.test.js` (209),
`benchmark-artifacts.test.js` (108), `scheduled-kickoff.test.js` (114),
`integration/agent-failover-end-to-end.test.js` (327), `beta-key-validation.test.js` (101 — drop).

**Not merged:** `index.js` (the `register()` bootstrap — its body is redistributed into
OSS server startup, then the file is dropped), `scripts/build.js` and `scripts/publish.js`
(esbuild bundling exists only to hide the beta key), `scripts/{add,remove}-beta-tester.sh`,
`dist/`, `lib/node_modules/@aigon/pro` self-symlink.

### The `register()` body must be redistributed, not ported

`aigon-pro/index.js` does five things at server boot. Each needs a new OSS home:

1. **Key validation** → delete.
2. **`registerRoute` × 14** → move each handler into the appropriate file under
   `lib/dashboard-routes/`. The handlers currently receive `helpers` (`loadProjectConfig`,
   `resolveRequestedRepoPath`, `sendJson`, `readConductorReposFromGlobalConfig`, `log`,
   `emitNotification`) via the bridge closure — in OSS they can require these directly.
3. **`supervisor.registerExhaustionHandler(...)`** (F421 failover) → the handler in
   `lib/agent-failover.js` becomes the only registrant. Either call it directly from
   `lib/supervisor.js` or keep the registration shape with a single in-repo caller.
4. **`workflowReadModel.registerFailoverActionAppender(...)`** → same treatment. **Careful:**
   this injects switch-agent items into `validActions`. Per CLAUDE.md hot rule 5c, action
   policy has exactly one source — fold the appender into the workflow definition or the
   projector rather than leaving a second policy site in the browser.
5. **Pollers** — `scheduledKickoff` poller and the hourly `_runBackupCheck` interval → start
   from OSS server startup unconditionally, preserving `.unref()`.

### Feature ID mapping (authoritative)

OSS's allocator currently sits at `feature.next = 696`, `research.next = 65`
(`.aigon/state/identity-sequences.json`). 692 was reserved and abandoned — **do not reuse it**;
reservations are never recycled (`lib/spec-store/identity-sequences.js`). 693 is this feature;
694 and 695 are its set peers. The import block therefore starts at **696**.

**Re-derive this table before running the import.** If any feature is created in this repo
between now and implementation, the allocator moves and the whole block shifts. The rule is
fixed — colliders map to a contiguous block starting at the allocator's current `next`, in
ascending original-ID order — but the literal numbers below are a snapshot taken 2026-07-25.

**Restored at original IDs** (verified vacant across every OSS stage folder):

`114` aade-insights · `115` aade-git-signals · `118` aade-amplification-dashboard ·
`122` aade-extract-to-private-package · `123` aade-telemetry · `152` pro-gated-reports ·
`153` pro-landing-page-and-docs · `159` pro-autonomy-bundle · `211` update-docs-telemetry-and-more ·
`219` pro-extension-point-single-seam · `221` pro-gate-infrastructure ·
`222` pro-gate-research-autopilot · `226` pro-availability-is-global-not-project-scoped

Research: `13` ai-development-effectiveness · `15` aade-commercial-gate · `23` autonomous-mode-as-pro

**Renumbered** (ascending original ID → contiguous block from 694, so relative chronology holds):

| Old | New | Title | Stage |
|-----|-----|-------|-------|
| 232 | — | aigon-pro-split-marker | **retired, not imported** |
| 233 | 696 | cross-repo-feature-support | paused (see duplicate note) |
| 234 | 697 | workflow-definitions-unified | done |
| 235 | 698 | workflow-model-picker-and-launch-honouring | done |
| 236 | 699 | move-backup-sync-and-scheduling-to-pro | done |
| 238 | 700 | merge-comparisons-extended-into-public-site | paused |
| 320 | 701 | recurring-features | done |
| 359 | 702 | aigon-state-sync | done |
| 367 | 703 | server-scheduled-kickoff-for-features-and-research | done |
| 379 | 704 | scheduler-agent-prompt-action | done |
| 380 | 705 | aigon-profile-sync | done |
| 388 | 706 | aigon-vault | done |
| 420 | 707 | settings-pro-perf-benchmark-dashboard | done |
| 421 | 708 | agent-failover-pro-tier | done |
| 431 | 709 | aigon-pro-github-packages-beta-distribution | done |
| 432 | 710 | publish-pipeline-minification | done |
| 433 | 711 | beta-key-validation | done |
| 434 | 712 | review-and-refine-tests-2026-w20 | backlog |
| 435 | 713 | security-scan-2026-w20 | backlog |
| 436 | 714 | agent-matrix-benchmark-2026-w20 | backlog |
| 437 | 715 | agent-matrix-pricing-refresh-2026-w20 | backlog |
| 438 | 716 | dep-sweep-2026-w20 | backlog |
| 439 | 717 | docs-gap-scan-2026-w20 | backlog |
| 440 | 718 | stale-entity-sweep-2026-w20 | backlog |
| 441 | 719 | workflow-state-integrity-2026-w20 | backlog |
| 442 | 720 | competitive-scan-2026-06 | backlog |
| 443 | 721 | agent-matrix-qualitative-refresh-2026-q3 | backlog |

Research renumbering: `24` git-native-team-sync-architecture → **65** · `25` marketing-aigon → **66** ·
`26` reduce-token-usage → **67**.

Seed `.aigon/state/identity-sequences.json` to `feature.next = 722`, `research.next = 68`
after the import.

**Known drift to resolve first:** `feature-233-cross-repo-feature-support.md` currently exists in
**both** `02-backlog/` and `06-paused/` in aigon-pro. Pick one stage (paused is the truthful one —
its workflow snapshot should confirm) and delete the other copy *before* renumbering, or the import
will produce two F694 files.

### Renumbering must move six things per feature, not one

Renaming the spec file alone will silently corrupt engine state. For each renumbered ID:

1. `docs/specs/features/<stage>/feature-<old>-<slug>.md` → `feature-<new>-<slug>.md`
2. `aigon_id: F<old>` in that file's frontmatter → `F<new>`
3. `docs/specs/features/logs/feature-<old>-<agent>-<slug>-log.md` → `feature-<new>-…`
   (30 feature logs, 17 research findings logs in aigon-pro)
4. `docs/specs/features/evaluations/feature-<old>-eval.md` → `feature-<new>-eval.md`
   (3 eval files: 114, 118, 123 — all restored IDs, so no rename needed for those; check for others)
5. `.aigon/workflows/features/<old>/` → `.aigon/workflows/features/<new>/`
   (70 feature dirs, 8 research dirs in aigon-pro) — and any `entityId`/`id` field *inside*
   `snapshot.json` and the event log
6. Any `feature-<old>` reference in the body of *other* imported specs and logs

Prefer writing a **single idempotent migration script** under `scripts/` (e.g.
`scripts/import-aigon-pro-specs.js`) that takes the mapping table as data, does all six moves,
and can be re-run. Do not hand-move files — CLAUDE.md hot rule 5 forbids manual spec moves, and
at this volume manual work will drift. The script is a one-shot; delete it in commit 6 or keep it
under `scripts/archive/` with a comment saying it is historical.

Note the OSS repo is on **legacy** spec layout (not `specLayout: stable`), so stage folders are
real directories, not symlinks — the script moves actual files. Verify with
`node -e "console.log(require('./lib/spec-layout'))"` before starting in case that changed.

### Sanitisation pass — what to strip, by file

Run this as a **reviewed pass, not a regex**: read every one of the 148 imported markdown files.
The known hot spots:

- **`feature-433-beta-key-validation.md` → F709.** Contains the beta-key design and a
  `const BETA_KEY = '<chosen-key>'` snippet. The *feature* is being deleted from the codebase.
  Either drop this spec entirely, or import it with the body reduced to a historical note
  ("private-beta access control, removed when Pro was merged into OSS"). Prefer dropping.
- **`feature-432-publish-pipeline-minification.md` → F708.** Exists only to hide the beta key.
  Same treatment.
- **`feature-431-aigon-pro-github-packages-beta-distribution.md` → F707.** Contains an email
  address and private distribution mechanics. Strip the address; keep the packaging lessons.
- **`feature-pro-licensing-and-billing.md`** (inbox) — vendor evaluation for Keygen/Stripe/
  Lemon Squeezy, explicitly about charging money. **Do not import.**
- **`feature-pro-autonomy-metering.md`** (inbox) — usage metering for billing. **Do not import.**
- **`research-15-aade-commercial-gate.md` + its 3 findings logs** — the entire topic is
  "what should we charge for". Import as historical record only if the body is rewritten to the
  product conclusions (which capabilities are valuable) with the pricing analysis removed;
  otherwise leave it in the private archive.
- **`research-23-autonomous-mode-as-pro.md` + 3 findings logs** — same judgment.
- **`research-25-marketing-aigon.md` + 3 findings logs** — marketing strategy. Leave in archive.
- **`feature-marketing-monitoring-and-metrics.md`, `feature-content-publishing-pipeline.md`,
  `feature-launch-campaign-prep.md`, `feature-remotion-videos.md`** (inbox) — marketing
  operations, not product. Leave in archive.
- **`research-24-git-native-team-sync-architecture.md` + `research-24-cc-findings.md`** —
  contains an email address. Strip it; the technical content is good and should come across
  (it is the design basis for Sync).
- **Every `pro-`-prefixed done spec (152, 153, 159, 219, 221, 222, 226)** — these are genuinely
  the design history of the extension seam and the gating, and they explain why `lib/pro-bridge.js`
  existed. Import them as-is; they are engineering history, not commercial material. Add a one-line
  banner at the top of each: `> Historical: Aigon Pro was merged into OSS by F693. This spec describes
  the tiered architecture as it existed.`
- **`.aigon/beta-testers/`, `.aigon/marketing/`, `MARKETING.md`, `docs/competitive/`,
  `docs/sdd-eval/`, `docs/proposals/`, `docs/hermes-vs-aigon-comparison.md`,
  `docs/marketing/`** — **none of this moves.** It stays in the private archive.

Every imported spec that references "Pro", "free tier", "gate", or "coming later" needs its
framing checked. The rule: **describe what the code did, never imply a product tier that no
longer exists.**

### Recurring templates need reconciliation, not copying

`docs/specs/recurring/` exists in both repos with three same-named files:
`review-and-refine-tests.md`, `security-scan-weekly.md`, `weekly-docs-gap-scan.md`. Diff each
pair and keep the better version. aigon-pro additionally has `competitive-refresh.md`,
`monthly-shippable-model-catalog-discovery.md`, `quarterly-agent-matrix-qualitative-refresh.md`,
`weekly-agent-matrix-benchmark.md`, `weekly-agent-matrix-pricing-refresh.md`,
`weekly-dep-sweep.md`, `weekly-stale-entity-sweep.md`, `weekly-workflow-state-integrity.md` —
import all eight, but note `competitive-refresh.md` is arguably a private/marketing task; check
its body before deciding.

OSS-only extras (`monthly-top-3-simplifications.md`, `weekly-dependency-triage.md`,
`weekly-model-catalog-intelligence.md`) stay. Watch for semantic duplicates across the two sets
(`weekly-dep-sweep` vs `weekly-dependency-triage`; `weekly-agent-matrix-*` vs
`weekly-model-catalog-intelligence`) — merge rather than ship two overlapping schedules.

### Migration for existing installs

Users upgrading from a version that had Pro installed will have `@senlabsai/aigon-pro` globally
installed and `proKey` in `~/.aigon/config.json`.

- Add a migration in `lib/migration.js` that deletes `proKey` from the global config.
- `aigon doctor` should detect a globally-installed `@senlabsai/aigon-pro` and tell the user to
  `npm uninstall -g @senlabsai/aigon-pro` — it is now dead weight and, worse, a stale copy of
  `lib/insights.js` etc. that could shadow the merged ones if anything still resolves it. Verify
  nothing does before shipping.
- Do **not** unpublish the `@senlabsai/aigon-pro` npm package (breaks existing lockfiles);
  publish a final version whose `register()` is a no-op with a deprecation notice, or simply
  mark it deprecated with `npm deprecate`.

### Non-obvious landmines found during research

- **`@aigon/pro` vs `@senlabsai/aigon-pro` inconsistency.** `lib/pro.js` resolves
  `@senlabsai/aigon-pro`, but `lib/commands/{recurring,schedule,agent-launch}.js` require
  `@aigon/pro/commands/…`. aigon-pro papers over this with a self-symlink at
  `lib/node_modules/@aigon/pro -> ../../..`. When deleting, grep for **both** spellings.
- **`lib/pro-bridge.js` has a legacy code path** (`wireLegacyInsightsRoutes`) that registers
  `/api/insights` routes for older Pro versions. Those two handlers must be preserved in the
  route-table move — they are the same endpoints, registered twice via different paths.
- **`isProAvailable()` is called by `lib/dashboard-routes/system.js`** to populate the Version
  panel via `getProStatus()`. That panel's shape changes; check the dashboard consumer.
- **`tests/integration/workflow-read-model.test.js` and `tests/unit/token-window.test.js`**
  in OSS reference Pro. They will need updating when the gating goes.
- **`scripts/test-brewboard-migration.sh`** references Pro. Check whether it sets
  `AIGON_FORCE_PRO`.
- **`entityUiContractFingerprint` / `computeStatusFingerprint`** — if any merged engine adds a
  field to `/api/status` that should repaint cards (failover state, schedule badges), it must be
  added to the fingerprint or SSE/ETag will not push it (CLAUDE.md hot rules 5b/5c).
- **Restart the server after every `lib/*.js` edit** (`aigon server restart`) — no hot reload.

## Dependencies

- Working tree clean in **both** repos before starting. `~/src/aigon-pro` currently has ~30
  modified files (mostly `.agents/skills/` and `.aigon/` install drift) — commit or discard them
  first so the merge diffs are readable.
- A full backup of both repos before commit 5 (the spec import is the irreversible step):
  `tar czf ~/Backups/aigon-premerge-$(date +%F).tar.gz -C ~/src aigon aigon-pro`
- Decide the fate of the published `@senlabsai/aigon-pro` npm package before close (deprecate,
  per the migration section).

## Out of Scope

- Publishing a release. The merge lands on `main`; `/release` is a separate, later step.
- Deleting the `aigon-pro` GitHub repo. It stays private and keeps marketing, competitive
  analysis, `docs/sdd-eval/`, and the beta-tester roster.
- Migrating marketing, competitive, sdd-eval, or beta-tester content into OSS.
- Any rewrite or improvement of the merged engines. Vendor them as-is; refactoring is a
  follow-up feature once the tests are green in their new home.
- Changing the licence. Everything merged becomes Apache 2.0 with the rest of the repo — confirm
  no merged file carries an `UNLICENSED` header before close.
- Building any replacement plugin/extension system. `pro-bridge.js` is deleted outright.
- **User-facing documentation** — README, CONTRIBUTING, AGENTS.md, `CLAUDE.md`,
  `templates/help.txt`, the whole docs site, and `docker/clean-room/`. Owned by **F694**.
- **The setup wizard** — the `pro` step and the Pro-gated vault step in
  `lib/onboarding/wizard.js` and `lib/onboarding/state.js`. Owned by **F695**.

## Open Questions

- **F711/F710 (beta-key + minification specs): drop or import as historical notes?** The
  recommendation above is to drop, which leaves gaps at 710–711. Confirm before the import script
  runs — the mapping table shifts if they are dropped rather than imported.
- **Research 15 and 23** are commercial-gate analyses whose *product* conclusions are worth
  keeping but whose *pricing* analysis is not. Rewrite-and-import, or leave in the archive?
- **`registerExhaustionHandler` / `registerFailoverActionAppender`**: keep the registration
  indirection with one in-repo caller, or inline? Inlining is simpler; the registration shape
  is only justified if a real second registrant is expected.
- Does anything in `~/.aigon/` (global state, worktrees, server registry) key off Pro availability
  in a way that persists across the upgrade? Worth a `grep -rn "proKey\|aigon-pro" ~/.aigon/`
  before commit 3.

## Related

- Research: none directly. Historical context in aigon-pro `research-15-aade-commercial-gate`
  and `research-23-autonomous-mode-as-pro` (the analyses that argued *for* the split now being undone).
- Prior work: F122 (extract to private package), F219 (the `pro-bridge` extension seam), F221
  (gate infrastructure), F226 (Pro availability is global, not project-scoped), F236 (moved
  Backup/Sync/Scheduling to Pro), F433 (beta-key validation). This feature reverses all of them.
- `docs/specs/features/MOVED-TO-AIGON-PRO.md` — the record of the 2026-04-07 split this undoes.
- `docs/architecture.md` § "Aigon Pro (`@aigon/pro`)" — the integration contract being deleted.
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="868" height="132" viewBox="0 0 868 132" role="img" aria-label="Feature dependency graph for feature 693" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-693" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 377 66, 491 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-693)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-693)"/><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-693)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#f3f4f6" stroke="#f59e0b" stroke-width="3"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#693</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">merge aigon pro into aigo…</text><text x="36" y="90" font-size="12" fill="#475569">inbox</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#f3f4f6" stroke="#9ca3af" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#694</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">merge pro docs into oss d…</text><text x="636" y="90" font-size="12" fill="#475569">inbox</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#f3f4f6" stroke="#9ca3af" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#695</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">remove aigon pro step fro…</text><text x="336" y="90" font-size="12" fill="#475569">inbox</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
