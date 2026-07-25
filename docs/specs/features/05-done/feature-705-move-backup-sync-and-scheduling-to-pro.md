---
aigon_id: F705
complexity: high
agent: cc
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-27T00:05:43.875Z", actor: "cli/feature-prioritise" }
---

> Historical: Aigon Pro was merged into OSS by F693. This spec describes the
> tiered architecture as it existed; Aigon has no paid tier.


# Feature: Move Backup & Sync and Scheduling to Pro

## Summary

Relocate two recently-shipped capability bundles from the public `aigon` repo
into the private `aigon-pro` repo: (1) Backup & Sync — F708, F711, F712 — and
(2) Scheduling — F707 recurring features, F709 server-scheduled kickoff, F710
scheduler `agent_prompt` action. Follow the existing `insights` pattern: OSS
keeps thin CLI verb stubs that delegate to `getPro().<module>`, OSS keeps tab
buttons with `PRO` superscript markers in `templates/dashboard/index.html`,
and Pro hosts the implementations behind those seams. Lift-and-shift only — no
new bridge extension points required.

History stays public. Forward-only deletion. Audience is small and technical;
the moat is ongoing development, not the code snapshot. Risk accepted.

## User Stories

- [ ] As an OSS user (no Pro), I see "Backup & Sync (PRO)" and "Scheduled
      Features (PRO)" tabs in the dashboard with the same gray treatment as
      the existing Insights tab. They explain the feature is Pro.
- [ ] As an OSS user, `aigon sync …`, `aigon vault …`, `aigon recurring …`
      all run, print a "this is a Pro feature" notice, and exit cleanly.
- [ ] As an OSS user, the dashboard server starts without auto-creating
      weekly recurring feature batches.
- [ ] As an OSS user, I can still run `aigon security-scan` (and other
      former-recurring actions) on demand from the CLI.
- [ ] As a Pro user, every moved capability works exactly as it did the day
      before — same CLI verbs, same dashboard panels, same weekly batches.
- [ ] As a contributor reading the OSS repo, recurring/sync are not part of
      the architecture I have to understand. AGENTS.md and CLAUDE.md no
      longer treat them as OSS-side concerns.

## Acceptance Criteria

### OSS-side: stubs and tab markers (kept)

- [ ] CLI verb stubs in `lib/commands/` for `sync`, `vault`, `recurring`
      that mirror the `insights` pattern at `lib/commands/misc.js:1061`:
      check `isProAvailable()`, print a Pro notice if not available,
      delegate to `getPro().<module>` if it is.
- [ ] Tab buttons in `templates/dashboard/index.html` for Backup & Sync and
      Scheduled Features with `<sup>PRO</sup>` superscript and matching
      empty `<div id="…-view">` targets, identical pattern to
      `tab-insights` / `#insights-view` (see lines 33 and 242).

### OSS-side: deletions

- [ ] Specs deleted from `docs/specs/features/05-done/`:
      F707, F708, F709, F710, F711, F712
- [ ] Implementation logs deleted from `docs/specs/features/logs/` for
      each of those six features
- [ ] `docs/specs/features/MOVED-TO-AIGON-PRO.md` updated with the six new
      IDs and one-line reasons
- [ ] Engine code deleted: `lib/sync-core.js`, `lib/sync-state.js`,
      `lib/backup.js`, `lib/recurring.js` (engine, not the stub),
      scheduler engine files (locate via `grep -rln "agent_prompt" lib/`)
- [ ] `docs/specs/recurring/*.md` (all 9 templates) deleted
- [ ] Recurring batch spawn block in `lib/dashboard-server.js` removed
      from server startup
- [ ] Sync-related notice in `lib/doctor*.js` removed
- [ ] Dashboard panel HTML/JS for Backup & Sync settings and scheduler UI
      removed from OSS-shipped assets (the empty target divs stay; their
      content moves to Pro)
- [ ] `aigon security-scan` retained as on-demand CLI (extract one-shot
      from F368, drop the weekly wrapper)
- [ ] `site/content/`: pages for sync, vault, recurring-features,
      scheduled-kickoffs deleted; nav updated
- [ ] AGENTS.md and CLAUDE.md updated: references to recurring, sync,
      vault, scheduler removed or rewritten
- [ ] `npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh`
      passes
- [ ] No stray imports — `node -c aigon-cli.js` succeeds and
      `grep -rln "require.*\(recurring\|sync-core\|sync-state\|backup\)" lib/`
      returns empty

### aigon-pro side

- [ ] All six specs land in `aigon-pro/docs/specs/features/05-done/` with
      original IDs preserved (G2 strategy)
- [ ] All six implementation logs land in
      `aigon-pro/docs/specs/features/logs/`
- [ ] All deleted lib files land in `aigon-pro/lib/`
- [ ] All 9 recurring templates land in `aigon-pro/docs/specs/recurring/`
- [ ] `aigon-pro/index.js` exports gain `{ sync, vault, recurring }`
      modules so OSS stubs can call `getPro().sync` etc.
- [ ] `aigon-pro/index.js` `register(api)` function: starts the recurring
      batch spawner inside the registration call (this IS the startup
      hook); registers any new HTTP routes the moved features need
- [ ] `aigon-pro/dashboard/` gains JS files that populate
      `#backup-sync-view` and `#scheduled-features-view` (or whichever
      IDs the OSS tabs declare); served via the existing `dashboardDir`
      mechanism
- [ ] OSS dashboard with Pro installed: Backup & Sync tab and Scheduled
      Features tab render identical UX to pre-move state
- [ ] `aigon sync configure/push/pull/status`, `aigon vault …`,
      `aigon recurring …` CLI verbs work identically to pre-move OSS
      behaviour when Pro is installed

### Cross-repo verification

- [ ] One full week elapses post-move with aigon-pro running and weekly
      batches created on schedule, no batches in OSS
- [ ] Docker Linux fresh-install smoke test (per
      `feedback_test_as_new_user`): server boots clean, no weekly
      features appear, CLI verbs print Pro-feature notices, tabs render
      with PRO markers and explain the upgrade

## Validation

```bash
node -c aigon-cli.js
grep -rln "require.*\(recurring\|sync-core\|sync-state\|backup\)" lib/ || echo "clean"
grep -rln "agent_prompt" lib/ || echo "clean"
grep -n "recurring" lib/dashboard-server.js | grep -v "stub\|// " || echo "clean"
ls docs/specs/recurring/ 2>/dev/null && echo "FAIL: directory should be gone" || echo "clean"
# With Pro installed, stubs delegate; without Pro, stubs print notices.
AIGON_FORCE_PRO=0 ./aigon-cli.js sync --help 2>&1 | grep -q "Pro feature"
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no
  dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`,
  `lib/server*.js`). Playwright still runs at the pre-push gate.
- May delete OSS spec, log, and lib files without per-file confirmation —
  the entire deletion list is enumerated above and is the explicit
  purpose of this feature.
- May commit OSS deletions in two commits (one for Backup & Sync, one for
  Scheduling) rather than per-file.
- May freely add modules to `aigon-pro/lib/` and exports to
  `aigon-pro/index.js` without per-file confirmation — receiving the
  moved files is the explicit purpose on the Pro side.

## Technical Approach

### Pattern reference

The migration follows the existing `insights` pattern verbatim. Read
these in order before starting:

- `lib/commands/misc.js:1061` — CLI verb stub that delegates to Pro
- `lib/pro.js` — `isProAvailable()` / `getPro()` detection
- `lib/pro-bridge.js` — `register(api)` startup invocation, route registry
- `aigon-pro/index.js` — current Pro registration shape
- `templates/dashboard/index.html:33,242` — tab + empty target div pattern
- `aigon-pro/dashboard/insights-dashboard.js` — Pro JS populating an OSS slot (legacy URL `/js/amplification.js` still served)

If the existing `insights` flow handles a need, copy it. Do not invent
parallel mechanisms.

### Sequencing

Two passes, smaller blast radius first.

**Pass 1 — Backup & Sync.** Reduce `aigon sync` and `aigon vault` to
delegating stubs. Add OSS tab + empty div for Backup & Sync (with PRO
marker). Delete `lib/sync-core.js`, `lib/sync-state.js`, `lib/backup.js`,
the doctor sync notice, sync-related dashboard JS. Move F708, F711, F712
specs+logs+lib to aigon-pro. Add `aigon-pro/dashboard/backup-sync.js`
that populates the slot. Add `sync` and `vault` exports to
`aigon-pro/index.js`. Verify with-Pro and without-Pro behaviour.

**Pass 2 — Scheduling.** Reduce `aigon recurring` to a delegating stub.
Add OSS tab + empty div for Scheduled Features (with PRO marker). Delete
`lib/recurring.js`, `lib/commands/recurring.js` engine internals (keep
the file as a thin stub), the 9 templates in `docs/specs/recurring/`,
the recurring spawn block in `dashboard-server.js`, the scheduler engine.
Move F707, F709, F710 specs+logs+lib+templates to aigon-pro. Add the
recurring spawner invocation inside `aigon-pro/index.js` `register(api)`.
Add `aigon-pro/dashboard/scheduled-features.js` that populates the slot.
Reduce F368 weekly-security-scanner to an on-demand `aigon security-scan`
in OSS (extract scan logic, drop cron wrapper).

### What stays in OSS

- `aigon security-scan` as a manual one-shot
- The `matrix-apply` family of CLI commands (already on-demand from F378)
- F366 getNextId-collision fix (defensive, applies regardless)
- All workflow primitives (engine, lifecycle, doctor core, dashboard core)
- CLI verb stubs (`sync`, `vault`, `recurring`) that delegate to Pro
- Dashboard tab buttons + empty target divs for the moved panels
- The pro-bridge file itself, unchanged

### Cross-repo file movement

By hand: copy file content into aigon-pro at the same relative path,
`git rm` from OSS, commit on each side. No filter-repo, no history
rewrite. Preserve original feature IDs in aigon-pro per G2.

### Cross-repo touch

OSS-side paths edited by this feature:

- `aigon-cli.js` (verb stub registration)
- `lib/commands/sync.js`, `lib/commands/vault.js`, `lib/commands/recurring.js`
  (reduced to delegating stubs)
- `lib/commands/misc.js` (security-scan as standalone, if needed)
- `lib/commands/security-scan.js` (drop cron wrapper)
- `lib/dashboard-server.js` (remove recurring spawn block)
- `lib/doctor*.js` (remove sync notice)
- `templates/dashboard/index.html` (add PRO tabs, remove inlined panel HTML)
- `docs/specs/features/05-done/feature-{320,359,367,379,380,388}*.md` (deleted)
- `docs/specs/features/logs/*` (matching logs deleted)
- `docs/specs/features/MOVED-TO-AIGON-PRO.md` (updated)
- `docs/specs/recurring/*.md` (all 9 deleted)
- `site/content/**` (sync/vault/recurring/scheduled docs deleted)
- `AGENTS.md`, `CLAUDE.md` (references rewritten)

OSS-side commits carry `Cross-repo: aigon-pro feature N` footer.

### Release-note moment

OSS release notes for this version state: "Backup & Sync and
recurring/scheduled features have moved to aigon-pro. The OSS dashboard
shows them as Pro-only tabs; the OSS server no longer auto-creates
weekly feature batches. Manual scan commands remain available."

### Risk: stranded users

Users on the prior version with weekly batches enabled: their existing
F389-F396 specs from past weeks remain in their working tree (created by
the OSS server before the move). They are just files; nothing breaks.
Future weeks simply produce no new batches.

## Dependencies

- aigon-pro repo writable
- `MOVED-TO-AIGON-PRO.md` index already exists in OSS (per
  `project_oss_pro_split` memory)
- F397 engine-first lifecycle precedence already shipped — recurring
  feature instances created pre-move stay valid under the new lifecycle
  rules

## Out of Scope

- Any history rewrite of the OSS repo
- Building a "Pro upsell" CTA in OSS beyond the existing `PRO` tab marker
  and the existing CLI Pro-notice format used by `insights`
- Reimplementing or refactoring the moved code in aigon-pro — lift and
  shift only
- Migration tooling for OSS users to "import their recurring config into
  Pro" — recurring state is tied to the spawn engine; no portable
  artifact
- Adding new bridge extension points — pattern reuse only

## Open Questions

- Are there analytics events (`recurring.batch_created`,
  `sync.push_completed`, etc.) currently consumed by OSS dashboard
  widgets that need their consumers cleaned up? Audit during Pass 1/2.
- Does the OSS dashboard rely on any read paths into sync state outside
  the panels themselves (e.g. a "last sync" badge in a status bar)?
  Audit during Pass 1.

## Related

- Research: —
- Set: oss-pro-realignment (proposed)
- Prior features in set: —
- Reference: `aigon/docs/specs/features/MOVED-TO-AIGON-PRO.md` (updated
  by this feature)
- Pattern reference: `aigon/lib/commands/misc.js:1061` (insights stub)
- Memory: `project_oss_pro_split.md`, `project_aade_commercial.md`
