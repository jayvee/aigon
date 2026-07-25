# Implementation Log: Feature 693 - merge-aigon-pro-into-aigon-oss
Agent: cc

## Status

Complete, in six commits as the spec phased it:

1. `feat: vendor aigon-pro engines into lib/` — 12 engine modules, relative requires.
2. `feat: register merged engines in CLI, server, dashboard` — routes, boot pollers, CLI verbs, ES-module dashboard panels.
3. `refactor: delete Pro gating apparatus` — pro.js, pro-bridge.js, stubs, badges, `aigon pro`, doctor + migration for stale installs.
4. `test: merge aigon-pro test suite` — 4 unit files imported, failover integration test reconciled.
5. `docs: import and sanitise aigon-pro spec history` — 106 markdown files, renumbered and sanitised.
6. `docs: record the merge in architecture.md and the archive repo`.

`npm run test:core` and `npm run test:iterate` (including the Playwright smoke
subset) are green. `npm run test:browser` in full has not been run — the spec
pre-authorises skipping it mid-iteration; it belongs to the deploy gate.

## New API Surface

- `lib/{insights,benchmark-artifacts,sync,sync-core,sync-merge,sync-state,backup,recurring,scheduled-kickoff,profile-state,agent-failover,cron-parse}.js`
- `lib/dashboard-routes/{insights,sync,scheduling,failover}.js` — the 13 endpoints that used to come through `pro-bridge`.
- `templates/dashboard/js/{benchmark-matrix,backup-sync,scheduled-features}.js` — real ES modules exporting `mountBenchmarkMatrix`, `renderBackupSync` / `fmtSyncTime`, `renderScheduledFeatures`.
- `templates/dashboard/styles/failover.css` (listed in `styles/manifest.json`).
- `scripts/import-aigon-pro-specs.js` — idempotent spec-history import.
- CLI: `aigon insights`, `backup`, `sync`, `vault`, `profile configure|push|pull|status`, `recurring-run`, `recurring-list`, `schedule`, `agent-launch` all run ungated.

Removed: `lib/pro.js`, `lib/pro-bridge.js`, `lib/dashboard-pro-assets.js`,
`lib/commands/pro.js`, `templates/dashboard/stubs/`, `supervisor.registerExhaustionHandler`,
`supervisor._resetExhaustionHandlers`, `workflowReadModel.registerFailoverActionAppender`,
`store.js isProActive` / `applyForceProOverride`, `statistics.js buildProGatedStatCard` /
`buildProGatedChart`, `/api/status` `proAvailable` + `proStatus`.

## Key Decisions

**Failover seams inlined, not kept as registries.** The spec left this open.
Both `registerExhaustionHandler` and `registerFailoverActionAppender` existed
only so an out-of-process package could subscribe; with the engine in-repo
there is exactly one registrant and the indirection is pure cost. The appender
now sits alongside `appendQuotaPausedDashboardActions` and
`appendEscalationDashboardActions` — matching the surrounding idiom and keeping
action policy to one source (hot rule 5c). The supervisor requires
`lib/agent-failover.js` lazily so the module graph stays acyclic.

**`insights-dashboard.js` and `pro-reports.js` were dead and are not imported.**
`aigon-pro/dashboard/insights-dashboard.js` is an unwrapped fragment that
nothing in OSS ever imported — `main.js` never referenced `/js/insights-dashboard.js`,
and the working Insights tab is OSS's own `js/views/insights-view.js`, which I
ungated instead. `pro-reports.js` had a stub and a `logs.js` dynamic loader in
OSS but **no implementation ever existed in aigon-pro**, so its `data-pro-slot`
placeholders could never be filled. I deleted the stub, the loader, and the
blurred pro-gated stat cards / charts it was supposed to replace; the real
metrics now render for everyone.

**The ID mapping was re-derived, not taken from the spec.** The spec's table was
a snapshot assuming `feature.next = 696`. By implementation time OSS had grown
to feature 701 and research 64, so the renumbered block runs **702–725** and
research 24/26 become **65/66**. Sequences seed to `feature.next = 726`,
`research.next = 67`. Dropping 432/433 means the block is contiguous over what
is actually imported rather than leaving reserved gaps.

**Research 15 and 23 stayed in the archive.** The spec's Open Question offered
"rewrite to product conclusions, or archive". Both are pricing and packaging
analyses — price points, per-seat comparisons, Keygen/Stripe/Lemon Squeezy
evaluation. Their conclusions were about *what to gate*, and nothing is gated
any more, so a rewrite would preserve no signal while risking commercial
content in a public repo. Research 25 (marketing) likewise. This deviates from
the numbering AC (which listed 15/23 restored and 25→66) in favour of the
sanitisation AC, which is the harder constraint.

**Feature 233 existed in two stage folders** in aigon-pro. Its snapshot says
`paused`, so the `02-backlog` copy is dropped and it imports as F702 paused.

## Gotchas / Known Issues

- **Engine state is gitignored.** `.aigon/workflows/` and `.aigon/state/` are in
  `.gitignore` and live in the primary checkout, not this worktree. The import
  script wrote 63 engine directories here, but they are not in the commit.
  **After this branch merges, run `node scripts/import-aigon-pro-specs.js` once
  from `~/src/aigon`, then `aigon doctor`.** This is recorded in
  `MERGED-FROM-AIGON-PRO.md` too. `aigon doctor` in this worktree reports "609
  features missing workflow state" for the same reason — every pre-existing OSS
  feature's state is in the main checkout. It does report
  "✅ All spec folders match workflow state" for what is here.
- **Two intentional `@senlabsai/aigon-pro` strings survive the spec's validation
  grep.** `lib/commands/setup/doctor.js` names the package because the spec's own
  migration section requires doctor to tell users to uninstall it. And
  `lib/onboarding/wizard.js` still has its Pro step — **F695 owns that file**. I
  only removed the wizard's `require('../pro')` so deleting `lib/pro.js` would not
  break it; its vault step now drives `lib/backup.js` directly. The validation line
  passes once F695 lands.
- **`lib/benchmark-artifacts.js` requires `./perf-bench`, which does not exist in
  OSS.** The call is already inside a try/catch that returns `[]`, so registry
  pairs are simply empty. Left as-is rather than papered over — vendoring is
  supposed to be faithful.
- `eslint.config.js` gained the Node 18+ `fetch` global for `lib/insights.js`.
- `~/src/aigon-pro/AGENTS.md` was rewritten to declare the repo a private
  archive, but **not committed** — that repo has ~190 files of unrelated install
  drift and committing there would sweep it up. Commit it yourself.

## Explicitly Deferred

- **F694** — README, CONTRIBUTING, AGENTS.md, CLAUDE.md, `templates/help.txt`,
  `site/`, `docker/`. All still describe a Pro tier. `templates/help.txt` still
  marks `feature-autonomous-start`, `research-autopilot` and `insights` as
  `[Pro]` and carries the "Pro features are currently in development" footer.
  The `aigon pro` verb itself is gone and was never listed there.
- **F695** — the wizard's `pro` step (installs the package, prompts for a beta
  key, writes `proKey`).
- Deciding the fate of the published `@senlabsai/aigon-pro` npm package. The
  code side is done (migration + doctor); `npm deprecate` is a manual step.
- Any refactor of the merged engines. They are vendored as-is by design; the
  only edits were relative requires, the `workflow-core` barrel in
  `recurring.js`, and `STAGE_FOLDERS` constants to satisfy `lint:paths`.

## For the Next Feature in This Set

F694 should reconcile `docs/architecture.md` § "Merged engines (formerly Aigon
Pro)" — this feature wrote the module facts; F694 owns the prose framing.

The `templates/dashboard/stubs/README.md` stub inventory is gone, so there is
no stub table left to purge.

## Test Coverage

- `tests/unit/{insights,benchmark-artifacts,backup,scheduled-kickoff}.test.js` — imported, all pass.
- `tests/integration/agent-failover-end-to-end.test.js` — merged: 3 supervisor scenarios (switch / chain-end / notify) now driving the real `handleExhaustion`, plus 3 `appendFailoverDashboardActions` cases from the aigon-pro copy. 4 passed.
- `beta-key-validation.test.js` deleted, not ported.
- `bash scripts/check-test-budget.sh`: 18148 / 200000 LOC (9%) — no bump needed.
- `npm run test:core` green (lint, path literals, module graph, alpine bindings, diagrams, budget, unit, integration, workflow).
- `npm run test:iterate` green including the `@smoke` Playwright subset (31 passed).
