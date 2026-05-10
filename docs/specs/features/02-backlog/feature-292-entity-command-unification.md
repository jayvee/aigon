# Feature: entity-command-unification

## Summary
`lib/commands/feature.js` (~3900 LOC) and `lib/commands/research.js` (~1100 LOC) contain near-mirror handlers for every parallel command — `spec-review`, `spec-review-check`, `spec-review-record`, `spec-review-check-record`, `prioritise`, `create`, `do`, `submit`, `eval`, `close`, `reset`. The handler pairs differ almost exclusively in `def = FEATURE_DEF` vs `def = RESEARCH_DEF` and a small number of entity-specific branches. `lib/entity.js` already has partial abstractions (`entitySubmit()`, `entityPrioritise()`, `RESEARCH_DEF`, `FEATURE_DEF`) — this feature finishes threading entity through the remaining duplicate handlers so the shared command implementation lives in one commands-layer module, driven by the entity definition and reused by both command factories.

Target: **1000–1500 LOC removed** from `lib/commands/feature.js` + `lib/commands/research.js` combined, plus elimination of a whole class of "defined in the handler but missing from the whitelist" drift bugs (the kind of bug I hit on 2026-04-21 where all four `*-spec-review-record` handlers existed but weren't exported from their factories).

## Desired Outcome
Adding a new parallel command (feature + research) requires editing ONE file, not two. When someone introduces a new lifecycle action, the implementation lives in a single place parameterised by entity type. The feature.js/research.js duplication, the `createFeatureCommands`/`createResearchCommands` hardcoded whitelists, and the four `*-record` sibling handlers that drifted apart without anyone noticing — all gone. A new maintainer reading the commands layer understands it in one pass rather than learning "it's like this in feature.js, but research.js has subtle differences."

## User Stories
- [ ] As a maintainer, when I add a new lifecycle command (e.g. `spec-review-reset`), I write one handler; both feature and research get it. No whitelist to remember to update.
- [ ] As an agent implementing a bug fix that touches lifecycle commands, I read ~50–100 lines of entity-driven factory instead of two ~3000-line files with subtle divergence.
- [ ] As a future Aigon extender, when I evaluate a third entity type, the command abstraction has a clear seam and does not require copying an entire second command file just to prototype it.
- [ ] As a reviewer auditing the codebase, the net LOC reduction (measured via `wc -l lib/commands/feature.js lib/commands/research.js` before vs. after) is 1000+ lines.

## Acceptance Criteria
- [ ] All parallel handler pairs in `lib/commands/feature.js` and `lib/commands/research.js` are collapsed into a single shared factory owned by the commands layer, preferably `lib/commands/entity-commands.js`. `lib/entity.js` remains the owner of entity definitions and small shared helpers rather than becoming a second large commands file. Specific pairs to collapse:
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
- [ ] The shared factory is parameterised by an entity definition (`FEATURE_DEF`, `RESEARCH_DEF`) plus explicit helper hooks only where behaviour truly differs. The abstraction carries the type-specific bits that the shared handlers actually need: prefix, folder paths, template names, tmux/session naming, and any entity-specific transition or eval hook required by the command.
- [ ] Entity-specific commands that have no research equivalent (`feature-autonomous-start`, `feature-autopilot`, `feature-cleanup`, `feature-close-restart` etc.) stay in `lib/commands/feature.js` and are clearly marked as feature-only. Research-specific commands (`research-autopilot`, `research-open`) stay in `lib/commands/research.js`.
- [ ] The `createFeatureCommands` / `createResearchCommands` hardcoded whitelists (`lib/commands/feature.js`, `lib/commands/research.js`) are either removed entirely (auto-export everything the factory returns) or derived from a single source of truth so the "defined but not whitelisted" bug becomes structurally impossible.
- [ ] Net LOC reduction across `lib/commands/feature.js` + `lib/commands/research.js` is at least **1000 lines**, measured via `wc -l` before and after.
- [ ] Existing tests continue to pass after any necessary refactor-driven updates. Tests that currently duplicate the same assertion across feature and research should be consolidated where that reduces duplication without obscuring the workflow difference being asserted.
- [ ] Add at least one regression test that fails if a shared parallel command is implemented but omitted from the feature/research export surface. This test should target the actual drift bug class from `*-spec-review-record` rather than snapshotting every command's full output.
- [ ] `AGENTS.md` and `docs/architecture.md` are updated to reflect the new module ownership (single shared commands factory, slimmer feature/research files).

## Validation
```bash
node -c lib/entity.js
test ! -f lib/commands/entity-commands.js || node -c lib/commands/entity-commands.js
node -c lib/commands/feature.js
node -c lib/commands/research.js
npm test
MOCK_DELAY=fast npm run test:ui
bash scripts/check-test-budget.sh
wc -l lib/commands/feature.js lib/commands/research.js   # verify LOC reduction
```

## Technical Approach

### Current state
- `FEATURE_DEF` and `RESEARCH_DEF` exist in `lib/entity.js` with fields like `type`, `prefix`, path accessors, template names, and `tmuxChar`.
- `entitySubmit(def, id, agentId, ctx)` is the only handler fully threaded through entity — it's the model for what the other commands should look like.
- Every other parallel handler has its own copy in feature.js AND research.js, with `def = FEATURE_DEF` / `def = RESEARCH_DEF` hardcoded in each.
- The XState machines (`featureMachine`, `researchMachine`) differ in the stage transitions research allows (no `eval_requested` for solo research, etc.), but the surface used by most commands is identical.

### Proposed shape
A single `createEntityCommands(def, ctx)` in `lib/commands/entity-commands.js` returns the shared parallel handlers. `createFeatureCommands` and `createResearchCommands` call it with the appropriate DEF, then add only their entity-specific commands. The shared factory must follow the existing `ctx` pattern rather than reaching for globals.

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
- **XState machine differences**: do not force the entire machine surface into the entity definition if a shared handler only needs one transition helper. Pass the minimum hook needed for each command so the abstraction stays readable instead of becoming a giant config blob.
- **`winnerAgentId` is feature-only**: features support `feature-eval` with winner selection; research `research-eval` doesn't pick a winner (it creates features). `entityEval(def, ...)` branches on `def.evalSelectsWinner` or similar.
- **`feature-autonomous-start` has no research equivalent today**: stays feature-only. `research-autopilot` is research-only.
- **Folder conventions**: already captured in the entity definitions; reuse that instead of reintroducing path conditionals in the command factory.
- **Tmux session naming**: already captured in `def.tmuxChar` — the `buildTmuxSessionName` helper already uses it.

### Collapse order (do in small, reviewable PRs)
1. **Spec-review quartet first** (`spec-review`, `spec-review-check`, `spec-review-record`, `spec-review-check-record`) — 8 handlers → 4. Easiest, already parallel.
2. **Create/prioritise** — file-move + commit logic, parameterised by `def.folders`.
3. **Submit** (`agent-status submitted` for features, `research-submit` for research) — already via `entitySubmit`, just finish threading the CLI-handler side.
4. **Eval/close/reset** — biggest gains, most risk. Save for last.
5. **Kill the whitelists** — remove `const names = [...]` in both factories or derive them from the shared command registry before deleting the old duplicate handlers.

### Risk and mitigation
- **XState drift between feature and research machines** is real but surfaced: `applyTransition` vs `applyResearchTransition` already live in `lib/workflow-core/engine.js` and are parallel. This feature doesn't consolidate the machines — only the commands that invoke them.
- **Subtle behaviour divergence** (e.g. feature-close calls `feature-close-scan-target` but research-close doesn't) is the real pitfall. Keep those seams explicit in the shared factory and cover them with focused regression tests around exported commands and entity-specific branches.
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
- Building a dashboard- or frontend-level registry for these commands. Export/eligibility ownership stays in the command modules and central workflow rules, not in frontend code.

## Open Questions
- Does `lib/entity.js` grow to absorb all the shared handlers, or do we introduce `lib/commands/entity-commands.js` as a sibling to feature.js/research.js? (Lean: new file — keep entity.js focused on data definitions + small helpers, not bulk command logic.)
- How do we handle commands that have asymmetric ergonomics — e.g. `aigon research-submit 34 cc` takes an explicit agent ID, while `aigon agent-status submitted` for features infers agent from branch? Current answer: keep the asymmetry at the CLI-shim level; consolidate only the core handler logic. (Lean: acceptable — surface ergonomics are fine to differ.)
- Do we remove the `createFeatureCommands` / `createResearchCommands` factory functions entirely, exposing a single `createEntityCommands(entityType)`? (Lean: keep the wrappers — the CLI entry `aigon-cli.js` composes them, churning that surface isn't worth it.)
- Should this feature land BEFORE `legacy-compat-path-cleanup` or after? (Lean: either order. They don't overlap file-wise; pick whichever you have more appetite for first.)

## Related
- Symptom that motivated this: 2026-04-21 bug fix `9b7d8689` — all four `*-spec-review-record` handlers were defined but missing from the hardcoded whitelists. Clean symptom of duplication + manual whitelist maintenance.
- Counterpart: `feature-legacy-compat-path-cleanup` (filed alongside) — different files, different surface, no overlap. Can run in parallel.
- `lib/entity.js` already contains the seed abstraction; this feature grows it to completion.
- CLAUDE.md § Write-Path Contract — every command that transitions lifecycle state has a corresponding write path. Unifying the commands doesn't change which events are emitted; it centralises WHO emits them.
