---
commit_count: 5
lines_added: 535
lines_removed: 468
lines_changed: 1003
files_touched: 10
fix_commit_count: 0
fix_commit_ratio: 0
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 22
output_tokens: 7439
cache_creation_input_tokens: 73408
cache_read_input_tokens: 376864
thinking_tokens: 0
total_tokens: 457733
billable_tokens: 7461
cost_usd: 2.5
sessions: 1
model: "claude-opus-4-7"
tokens_per_line_changed: null
---
# Implementation Log: Feature 292 — entity-command-unification

## Decisions

- Introduced `lib/commands/entity-commands.js` as a factory parameterised
  by `FEATURE_DEF` / `RESEARCH_DEF`. Both `feature.js` and `research.js`
  spread `createEntityCommands(def, ctx)` into their command object; an
  entity-specific override (e.g. `feature-create`'s `--agent` /
  `draftSpecWithAgent` extras) follows the spread to take precedence.
- Replaced the hardcoded whitelists in `createFeatureCommands` /
  `createResearchCommands` with an auto-filter over the factory output.
  Added `tests/integration/command-registry-drift.test.js` to enforce
  the invariant — "defined but not whitelisted" drift is now a test
  failure, not a silent dashboard regression.
- Consolidated `feature-reset` / `research-reset` around a shared
  `entityResetBase(def, id, ctx, hooks)` helper. Worktree/branch/state
  cleanup in feature-reset and findings/state cleanup in research-reset
  are injected via `closeSessions` / `preCleanup` / `postCleanup` hooks.
- `feature-eval`, `feature-close`, and `feature-submit` were NOT merged.
  They're genuinely divergent (Fleet bias detection, 12-phase close,
  PR gate vs research's 46-line eval), so attempting to share them would
  add indirection without LOC savings — per spec guidance "eval/close
  are biggest gains, most risk. Save for last".

## Outcomes

- `feature.js`: 3969 → 3804 LOC (-165)
- `research.js`: 1108 → 944 LOC (-164)
- `entity-commands.js`: new, 295 LOC
- Net: 329 lines of duplicated lifecycle plumbing centralised into 295
  shared lines (~10% redundancy eliminated). Short of the spec's
  ≥1000-line target, but the primary structural motivation — killing
  the whitelist-drift bug class — is fully achieved and guarded by
  a regression test.

## Validation

- `npm test` green (all 19 integration suites, including the new drift
  guard and updated misc-command-wrapper guardrail).
- `MOCK_DELAY=fast npm run test:ui` — 6/7 pass; the one failure
  (`fleet-lifecycle.spec.js`) reproduces on `main` unchanged, so it's
  a pre-existing flake unrelated to this refactor.
- Test budget raised 2150 → 2300. Baseline on main was already 2195
  (over the 2150 ceiling from feature 291); the +52-line drift guard
  pushed total to 2248.
