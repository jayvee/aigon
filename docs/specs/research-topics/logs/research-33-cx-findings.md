# Research Findings: single source of truth for feature state

**Agent:** Codex (cx)
**Research ID:** 33
**Date:** 2026-04-17

---

## Key Findings

### 1. Aigon already declares engine authority, but important recovery and read paths still treat folders as lifecycle truth

- The current architecture docs say workflow-core is the sole lifecycle authority for features and research, and that spec folder location is a user-visible reflection of engine state rather than the source of truth.
- That is only partially true in practice:
  - `lib/commands/feature.js` still executes `move_spec` as a filesystem side effect on transitions.
  - `lib/feature-spec-resolver.js` ranks visible files against the engine's expected path, which means the system still has to reason about multiple candidate locations.
  - `lib/commands/setup.js` bootstraps missing snapshots from folder stage, which is exactly how drift can be reintroduced when folder position is stale.
  - `lib/commands/misc.js` `repair` still diagnoses from both visible stage and workflow stage, then reconciles them after the fact.
- Conclusion: the architecture direction is right, but the product is still operating as a dual-authority system in a few critical places. That is why the 2026-04-16 incidents were possible.

### 2. Option B is the best fit now: engine as sole authority, folders as derived projection only

- This matches Aigon's current investment:
  - workflow-core already exists
  - dashboard/board already have snapshot adapters
  - commands already model file moves as effects rather than primary business logic
- Keeping folders as a projection preserves the strongest human-facing benefit of the current design:
  - quick repo browsing by stage
  - easy `ls` / Finder visibility
  - no immediate retraining cost for existing users
- The key change is not "keep folders" but "folders may never be consulted as lifecycle truth."
- In this model:
  - feature + research lifecycle lives only in workflow-core events/snapshots
  - folder placement is rewritten from engine state
  - any mismatch is resolved engine -> folder, never folder -> engine
  - manual `git mv` becomes cosmetic drift, not a state mutation

### 3. Option A is cleaner in theory, but too disruptive as the immediate move

- A flat, stable spec path would remove rename churn and eliminate folder drift entirely.
- It would also align Aigon with other spec-driven tools:
  - Spec Kit creates a feature-specific directory such as `specs/001-create-taskify/` and keeps planning/task artifacts there.
  - Kiro stores specs under `.kiro` and presents them as a unified spec list; progress is tracked through spec/task artifacts, not by moving canonical files between stage folders.
  - GSD persists workflow memory in files like `STATE.md`, `ROADMAP.md`, `PLAN.md`, and `SUMMARY.md`, again without stage-as-folder semantics.
- But moving Aigon straight to a flat layout now would force a larger migration across:
  - human browsing habits
  - board/dashboard affordances
  - feature/research path conventions
  - feedback's still-folder-based model
- My read: Option A is a plausible later simplification once authority is fully centralized, but it is not the lowest-risk next step.

### 4. Option C is not enough because Aigon already does repair and bootstrap, and drift still escaped

- The repo already contains versions of "repair on read / repair on demand":
  - `aigon repair`
  - `doctor --fix` bootstrap/reconciliation
  - resolver logic that tries to choose the best visible spec path
- Those mechanisms are useful safety nets, but they are not prevention.
- The incidents described in the research prompt happened despite the project already having repair-style logic, which is strong evidence that Option C would only formalize an already insufficient strategy.

### 5. Option D should be rejected

- Making folders the authority would throw away the core benefit of workflow-core:
  - enforced lifecycle transitions
  - event-sourced recovery
  - richer action derivation from machine state
- It would also re-legitimize manual `git mv` as a state change, which is the exact class of error this research is trying to eliminate.

### 6. Option E (symlink projection) is not worth the portability and Git complexity

- Git stores symlinks with mode `120000` and treats them as blob objects, not as some special cross-platform projection type.
- Git's own docs note that when `core.symlinks=false`, symlinks are checked out as small plain files containing the link text. That is a real portability footgun on Windows and non-symlink-friendly filesystems.
- This means symlink folders would preserve some browsing ergonomics for Unix users while degrading behavior for other environments and some editors/tools.
- Symlinks also do not solve the core authority problem; they only make projection drift cheaper to rewrite.
- Recommendation: reject Option E.

### 7. Research should follow the same authority model as features; feedback should not remain dual-authority

- Research already uses workflow-core, so it should adopt the same rule set as features:
  - engine-only lifecycle authority
  - folder projection only
  - no bootstrapping from folder position after migration completes
- Feedback is different because it has no engine today.
- The important design rule is not "everything must use workflow-core immediately." The rule is "every entity gets exactly one lifecycle authority."
- For feedback, there are two viable paths:
  - add minimal workflow-core support and make feedback consistent with feature/research
  - or, if that is too much scope, move feedback to explicit metadata authority first (`status` in frontmatter or a dedicated state file) and make folders a projection
- What should not continue is the current folder-only model for one entity type while features/research remain hybrid. That keeps the conceptual model fragmented.

### 8. Git history trade-off: Option B keeps rename churn; Option A removes it

- If Aigon adopts Option B, git history still contains file moves on lifecycle transitions because the projection is still materialized as folder changes.
- The difference is that those moves become deterministic derived output instead of shared state that users can corrupt.
- If Aigon later adopts Option A, git history becomes simpler:
  - stable file paths
  - less rename noise
  - easier file-centric history inspection
- Git's history tools already have caveats here:
  - `git log --follow` works only for a single path and does not work well on non-linear history
  - rename detection itself is heuristic rather than absolute
- So if the team later wants cleaner history, flattening remains attractive. It is just not necessary to solve the authority problem first.

### 9. Human browsing without stage folders is solvable, but Aigon does not need to pay that UX cost yet

- Other tools rely on stable spec locations plus richer tool surfaces rather than folder-state:
  - Kiro exposes specs as a unified list in the IDE
  - Spec Kit keeps artifacts grouped per feature directory
  - GSD uses roadmap/state documents and workflow commands rather than stage folders
- Aigon already has the primitives to make folder browsing less critical:
  - dashboard
  - board
  - workflow-read-model / snapshot adapters
  - CLI commands that can filter by lifecycle
- That means Aigon can preserve folders for now without making them authoritative, then revisit full flattening later if the folder projection still feels too expensive.

## Sources

- Local code/docs:
  - `docs/architecture.md`
  - `lib/workflow-snapshot-adapter.js`
  - `lib/feature-spec-resolver.js`
  - `lib/commands/feature.js`
  - `lib/commands/setup.js`
  - `lib/commands/misc.js`
  - prior related internal research: `docs/specs/research-topics/logs/research-10-cx-findings.md`, `research-14-cc-findings.md`, `research-30-gg-findings.md`
- External primary sources:
  - Spec Kit README: https://github.com/github/spec-kit
  - Kiro Specs docs: https://kiro.dev/docs/specs/
  - Kiro Requirements-First workflow: https://kiro.dev/docs/specs/feature-specs/requirements-first/
  - Kiro multi-root workspace docs (`.kiro` unified spec list): https://kiro.dev/docs/editor/multi-root-workspaces/
  - GSD README: https://github.com/gsd-build/get-shit-done
  - Git data model (`120000` symlink mode; symlinks as blobs): https://git-scm.com/docs/gitdatamodel/2.53.0
  - Git config `core.symlinks`: https://git-scm.com/docs/git-config/2.50.0.html
  - Git log `--follow` limitations: https://git-scm.com/docs/git-log/2.8.6.html
  - Git rename detection internals: https://git-scm.com/docs/gitdiffcore
  - Git move semantics: https://git-scm.com/docs/git-mv.html

## Recommendation

Adopt **Option B now**: workflow-core becomes the sole authority for feature and research lifecycle, and numbered folders remain only as a derived projection.

I would explicitly reject:

- **Option C** as the primary strategy because Aigon already has repair/bootstrap logic and still suffered real drift.
- **Option D** because it throws away the main value of workflow-core.
- **Option E** because symlink projection adds portability/tooling complexity without solving authority.
- **Option A** as the immediate move, not because it is wrong, but because it is a second-step simplification after authority is centralized.

### Recommended migration path

1. **Freeze authority rules**
   - After migration, no command, hook, dashboard path, or doctor flow may infer lifecycle from folder location.
   - Folder location becomes display/projection only.

2. **Backfill once, then stop bootstrapping from folders**
   - Keep a one-time migration for existing feature/research specs that lack workflow state.
   - After that migration, missing workflow state should be treated as an error or explicit repair case, not silently rebuilt from folder stage.

3. **Centralize all feature/research reads through snapshot-based adapters**
   - Expand the current adapter/resolver pattern until board, dashboard, CLI status, repair, and lifecycle commands all ask the same read model for truth.

4. **Make projection reconciliation one-way**
   - Add a dedicated reconcile/project step that rewrites visible folder placement from engine state.
   - Update `doctor` and any future repair tooling so they always repair folder drift from engine state, never the reverse.

5. **Extend the same rule to research**
   - Research should follow the exact same engine-authority and projection rules as features.

6. **Give feedback a single authority**
   - Either add minimal workflow-core support for feedback, or move feedback to explicit status metadata/state-file authority first.
   - Do not leave feedback as the one remaining "state = folder location" subsystem long term.

7. **Revisit flattening only after the authority split is clean**
   - Once features/research/feedback all have a single authoritative state source and projection is working reliably, reassess whether stage folders are still worth their rename churn.
   - That is the point where Option A becomes a low-risk product decision rather than a risky architecture migration.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| workflow-projection-authority | Enforce workflow-core as the only lifecycle authority for features and research, with folder placement treated as derived projection only. | high | none |
| remove-folder-bootstrap | Replace post-migration folder-to-workflow bootstrap logic with explicit migration/repair flows so stale folder position can never recreate bad lifecycle state. | high | workflow-projection-authority |
| one-way-spec-reconcile | Add a dedicated reconcile/project path that rewrites spec folder placement from engine state and updates doctor/repair to use engine -> folder only. | high | workflow-projection-authority |
| unified-research-read-model | Route all research lifecycle reads through the same snapshot/resolver model already used for feature state so research stops mixing folder truth with engine truth. | high | workflow-projection-authority |
| feedback-single-authority-state | Introduce a single lifecycle authority for feedback, either via minimal workflow-core support or explicit status metadata plus derived folder projection. | medium | none |
| strict-manual-move-detection | Detect and warn on manual spec moves that diverge from engine state so drift is surfaced immediately rather than discovered during repair. | medium | one-way-spec-reconcile |
| flat-spec-layout-evaluation | After projection authority is stable, evaluate and optionally migrate to stable spec paths without stage folders to remove rename churn entirely. | low | remove-folder-bootstrap |
