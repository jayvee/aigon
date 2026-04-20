# Feature: entity-command-unification

## Summary
`lib/commands/feature.js` (~3900 LOC) and `lib/commands/research.js` (~1100 LOC) contain near-mirror handlers for every parallel command — `spec-review`, `spec-review-check`, `spec-review-record`, `spec-review-check-record`, `prioritise`, `create`, `do`, `submit`, `eval`, `close`, `reset`. The handler pairs differ almost exclusively in `def = FEATURE_DEF` vs `def = RESEARCH_DEF` and a handful of entity-specific branches. `lib/entity.js` already has partial abstractions (`entitySubmit()`, `entityPrioritise()`, `RESEARCH_DEF`, `FEATURE_DEF`) — this feature finishes threading entity through the remaining duplicate handlers so the two files collapse into one shared factory driven by the entity definition.

Target: **1000–1500 LOC removed** from `lib/commands/feature.js` + `lib/commands/research.js` combined, plus elimination of a whole class of "defined in the handler but missing from the whitelist" drift bugs (the kind of bug I hit on 2026-04-21 where all four `*-spec-review-record` handlers existed but weren't exported from their factories).

## Desired Outcome
Adding a new parallel command (feature + research) requires editing ONE file, not two. When someone introduces a new lifecycle action, the implementation lives in a single place parameterised by entity type. The feature.js/research.js duplication, the `createFeatureCommands`/`createResearchCommands` hardcoded whitelists, and the four `*-record` sibling handlers that drifted apart without anyone noticing — all gone. A new maintainer reading the commands layer understands it in one pass rather than learning "it's like this in feature.js, but research.js has subtle differences."

## User Stories
- [ ] As a maintainer, when I add a new lifecycle command (e.g. `spec-review-reset`), I write one handler; both feature and research get it. No whitelist to remember to update.
- [ ] As an agent implementing a bug fix that touches lifecycle commands, I read ~50–100 lines of entity-driven factory instead of two ~3000-line files with subtle divergence.
- [ ] As a future Aigon extender, when I want to introduce a third entity type (e.g. feedback items becoming first-class lifecycle entities), the entity abstraction makes it an afternoon of config, not a week of copy-paste.
- [ ] As a reviewer auditing the codebase, the net LOC reduction (measured via `wc -l lib/commands/feature.js lib/commands/research.js` before vs. after) is 1000+ lines.

## Acceptance Criteria
- [ ] All parallel handler pairs in `lib/commands/feature.js` and `lib/commands/research.js` are collapsed into a single shared factory — either in `lib/entity.js` (if it grows into a full commands module) or a new `lib/commands/entity-commands.js`. Specific pairs to collapse (non-exhaustive):
  - `feature-create` / `research-create`
  - `feature-prioritise` / `research-prioritise`
  - `feature-spec-review` / `research-spec-review`
  - `feature-spec-review-check` / `research-spec-review-check`
  - `feature-spec-review-record` / `research-spec-review-record`
  - `feature-spec-review-check-record` / `research-spec-review-check-record`
  - `feature-submit` (via agent-status) / `research-submit`
  - `feature-eval` / `research-eval`
  - `feature-close` / `research-close`
  - `feature-reset` / `research-reset`
- [ ] The shared factory is parameterised by an entity definition (`FEATURE_DEF`, `RESEARCH_DEF`) that carries the type-specific bits: prefix, folder paths, XState machine reference, bootstrap event shape, CLI arg names, tmux session naming convention.
- [ ] Entity-specific commands that have no research equivalent (`feature-autonomous-start`, `feature-autopilot`, `feature-cleanup`, `feature-close-restart` etc.) stay in `lib/commands/feature.js` and are clearly marked as feature-only. Research-specific commands (`research-autopilot`, `research-open`) stay in `lib/commands/research.js`.
- [ ] The `createFeatureCommands` / `createResearchCommands` hardcoded whitelists (`lib/commands/feature.js:3891`, `lib/commands/research.js:1098`) are either removed entirely (auto-export everything the factory returns) or derived from a single source of truth so the "defined but not whitelisted" bug becomes structurally impossible.
- [ ] Net LOC reduction across `lib/commands/feature.js` + `lib/commands/research.js` is at least **1000 lines**, measured via `wc -l` before and after.
- [ ] All existing tests pass without modification. Tests that today assert identical behaviour for feature and research (e.g. `tests/integration/spec-review-status.test.js`) shrink proportionally — one test per behaviour, parameterised by entity type where meaningful.
- [ ] New test: a contract test that verifies EVERY parallel command pair produces behaviourally identical output for equivalent inputs (snapshot shape, event sequence, exit codes). Prevents future drift at the behaviour level, not just the file level.
- [ ] `docs/architecture.md` § Module Map is updated to reflect the new shape (single shared commands factory, trimmed feature/research files).

## Validation
```bash
node -c lib/entity.js
node -c lib/commands/feature.js
node -c lib/commands/research.js
npm test
MOCK_DELAY=fast npm run test:ui
bash scripts/check-test-budget.sh
wc -l lib/commands/feature.js lib/commands/research.js   # verify LOC reduction
```

## Technical Approach

### Current state
- `FEATURE_DEF` and `RESEARCH_DEF` exist in `lib/entity.js` with fields like `type`, `prefix`, `docsDir`, `tmuxChar`.
- `entitySubmit(def, id, agentId, ctx)` is the only handler fully threaded through entity — it's the model for what the other commands should look like.
- Every other parallel handler has its own copy in feature.js AND research.js, with `def = FEATURE_DEF` / `def = RESEARCH_DEF` hardcoded in each.
- The XState machines (`featureMachine`, `researchMachine`) differ in the stage transitions research allows (no `eval_requested` for solo research, etc.), but the surface used by most commands is identical.

### Proposed shape
A single `createEntityCommands(def)` in `lib/entity.js` (or new file `lib/commands/entity.js`) returns all the parallel handlers. `createFeatureCommands` and `createResearchCommands` call it with the appropriate DEF, plus tack on the entity-specific handlers (autonomous-start for feature, autopilot for research).

Roughly:
```js
function createEntityCommands(def, ctx) {
  return {
    [`${def.prefix}-create`]: args => entityCreate(def, args, ctx),
    [`${def.prefix}-prioritise`]: args => entityPrioritise(def, args, ctx),
    [`${def.prefix}-spec-review`]: args => entitySpecReview(def, args, ctx),
    // ... 20+ more
  };
}

function createFeatureCommands(ctx) {
  return {
    ...createEntityCommands(FEATURE_DEF, ctx),
    'feature-autonomous-start': args => featureAutonomousStart(args, ctx),
    'feature-autopilot': args => featureAutopilot(args, ctx),
    // ... feature-only handlers
  };
}
```

### Where the abstraction breaks and how to handle it
- **XState machine differences**: store the machine in `def.machine` and route through it. Where machines accept different event shapes, keep the event construction in the entity-specific code (there's very little of this).
- **`winnerAgentId` is feature-only**: features support `feature-eval` with winner selection; research `research-eval` doesn't pick a winner (it creates features). `entityEval(def, ...)` branches on `def.evalSelectsWinner` or similar.
- **`feature-autonomous-start` has no research equivalent today**: stays feature-only. `research-autopilot` is research-only.
- **Folder conventions**: already captured in `def.folders`.
- **Tmux session naming**: already captured in `def.tmuxChar` — the `buildTmuxSessionName` helper already uses it.

### Collapse order (do in small, reviewable PRs)
1. **Spec-review quartet first** (`spec-review`, `spec-review-check`, `spec-review-record`, `spec-review-check-record`) — 8 handlers → 4. Easiest, already parallel.
2. **Create/prioritise** — file-move + commit logic, parameterised by `def.folders`.
3. **Submit** (`agent-status submitted` for features, `research-submit` for research) — already via `entitySubmit`, just finish threading the CLI-handler side.
4. **Eval/close/reset** — biggest gains, most risk. Save for last.
5. **Kill the whitelists** — remove `const names = [...]` in both factories; auto-export.

### Risk and mitigation
- **XState drift between feature and research machines** is real but surfaced: `applyTransition` vs `applyResearchTransition` already live in `lib/workflow-core/engine.js` and are parallel. This feature doesn't consolidate the machines — only the commands that invoke them.
- **Subtle behaviour divergence** (e.g. feature-close calls `feature-close-scan-target` but research-close doesn't) is the real pitfall. Catch it with the contract test above.
- **Landing this on main while F288/F289/F290 are in flight** — those features don't touch `lib/commands/feature.js` or `lib/commands/research.js` substantially, so conflict risk is low.

## Dependencies
- None hard. F287 is done. F288/F289/F290 target different files.
- **Does NOT depend on F291** — model-picker work touches agent-registry + engine state + dashboard; this feature doesn't.

## Out of Scope
- Consolidating the XState machines themselves (`applyTransition` vs `applyResearchTransition`). Too risky, separate effort if ever.
- Making feedback (`lib/commands/feedback.js`) fit the entity abstraction — feedback's state machine is fundamentally different (frontmatter-based, no event log). If unified later, that's its own feature.
- Adding new commands or new lifecycle shapes. This feature is pure refactor; behaviour is unchanged.
- Splitting `lib/commands/feature.js` further by lifecycle boundary — that's a separate simplification feature.
- Generating typed TypeScript interfaces for the entity def — JS with JSDoc is fine.

## Open Questions
- Does `lib/entity.js` grow to absorb all the shared handlers, or do we introduce `lib/commands/entity.js` as a sibling to feature.js/research.js? (Lean: new file — keep entity.js focused on data definitions + small helpers, not bulk command logic.)
- How do we handle commands that have asymmetric ergonomics — e.g. `aigon research-submit 34 cc` takes an explicit agent ID, while `aigon agent-status submitted` for features infers agent from branch? Current answer: keep the asymmetry at the CLI-shim level; consolidate only the core handler logic. (Lean: acceptable — surface ergonomics are fine to differ.)
- Do we remove the `createFeatureCommands` / `createResearchCommands` factory functions entirely, exposing a single `createEntityCommands(entityType)`? (Lean: keep the wrappers — the CLI entry `aigon-cli.js` composes them, churning that surface isn't worth it.)
- Should this feature land BEFORE `legacy-compat-path-cleanup` or after? (Lean: either order. They don't overlap file-wise; pick whichever you have more appetite for first.)

## Related
- Symptom that motivated this: 2026-04-21 bug fix `9b7d8689` — all four `*-spec-review-record` handlers were defined but missing from the hardcoded whitelists. Clean symptom of duplication + manual whitelist maintenance.
- Counterpart: `feature-legacy-compat-path-cleanup` (filed alongside) — different files, different surface, no overlap. Can run in parallel.
- `lib/entity.js` already contains the seed abstraction; this feature grows it to completion.
- CLAUDE.md § Write-Path Contract — every command that transitions lifecycle state has a corresponding write path. Unifying the commands doesn't change which events are emitted; it centralises WHO emits them.
