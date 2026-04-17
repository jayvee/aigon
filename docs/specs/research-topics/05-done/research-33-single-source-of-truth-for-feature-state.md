# Research: single-source-of-truth-for-feature-state

## Context

Feature and research lifecycle state is stored in two places that can desync:

1. **Spec file location** — `docs/specs/features/02-backlog/feature-29-*.md` implies "backlog"
2. **Workflow engine snapshot** — `.aigon/workflows/features/29/snapshot.json` says `lifecycle: "backlog"`

When these disagree, the dashboard shows stale data, the board shows wrong columns, and users/agents manually move files — making it worse. Real incidents from 2026-04-16:

- Feature #01 (completed months ago) appeared in backlog because `check-version` ran `git add docs/` and swept a stale file move into an auto-commit
- Feature #29 (completed months ago) appeared in backlog because the doctor bootstrap created a snapshot with `lifecycle: "backlog"` for a spec that was actually in `05-done/`
- Features 250-253 required manual snapshot edits + file moves + event appends to change state — three operations that must stay in sync

The current architecture was intentional (folders as human-readable projection of engine state) but the enforcement is weak. Any `git mv`, broad `git add`, or manual operation can desync the two layers.

## Questions to Answer

- [ ] Should the workflow engine be the sole authority, with folders as a derived projection?
- [ ] Should folders be eliminated entirely (flat structure, state only in engine)?
- [ ] Is there a hybrid approach where folders exist but are auto-corrected from engine state?
- [ ] What is the migration path from the current dual-authority system?
- [ ] How does this affect research and feedback entities (which don't use the workflow engine yet)?
- [ ] What happens to the git history if we stop moving files between folders?
- [ ] How do humans browse specs by stage without folders (tags? CLI queries? dashboard only?)?
- [ ] What do other spec-driven tools (SpecKit, Kiro, GSD) do for state management?

## Scope

### In Scope

- Feature lifecycle state (the primary pain point)
- Research lifecycle state (uses the same folder pattern + a simpler engine)
- Feedback lifecycle state (folder-based only, no engine yet)
- The `check-version` / `install-agent` / `doctor` paths that touch spec files
- Dashboard and board read paths
- CLI commands that transition state (`feature-start`, `feature-close`, `feature-reset`, etc.)

### Out of Scope

- Workflow engine internals (XState machine, event store, locking) — those work fine
- Agent prompt delivery or slash command mechanics
- Dashboard UI redesign
- Multi-repo or team sync scenarios

## Options to Evaluate

### Option A: Stop moving files entirely

- Specs stay in a single folder (e.g. `docs/specs/features/`)
- Stage is ONLY in the workflow engine snapshot
- The numbered folder structure (`01-inbox/`, `02-backlog/`, etc.) goes away
- **Pros:** eliminates the desync problem completely; simpler git history
- **Cons:** big migration; loses the visual folder browsing that's nice for humans reading the repo; `git log` on a folder no longer shows "what's in backlog"

### Option B: Engine is sole authority, folders are a derived projection

- Keep the folders, but make the engine the ONLY thing that moves files
- No CLI command, no agent, no hook is allowed to `git mv` a spec directly
- All state transitions go through the engine, which moves the file as a side effect
- If the folder disagrees with the engine, the engine wins and the file gets auto-corrected on next read
- **Pros:** keeps the folder convenience; eliminates desync; self-healing
- **Cons:** need to enforce "never move spec files manually" everywhere; reconciliation logic adds complexity; git diffs show file moves on every state transition (same as today)

### Option C: Reconcile on read (status quo + repair)

- Accept that desync will happen
- Every read path (dashboard, board, feature-list) checks both and prefers the engine
- `aigon repair` fixes drift when noticed
- Narrow the `git add` paths (already done in feature 265)
- **Pros:** least change; works today
- **Cons:** doesn't prevent the problem, just patches after the fact; users hit stale state before noticing; manual repair is annoying

### Option E: Symlinks in folders, canonical files in one location

- Spec files live in a single flat directory (e.g. `docs/specs/features/all/`)
- The numbered folders (`01-inbox/`, `02-backlog/`, etc.) contain **symlinks** pointing to the canonical file
- State transitions update the symlink (delete from old folder, create in new) — the real file never moves
- Engine snapshot points to the canonical path; folder symlinks are derived
- **Pros:** one canonical file path forever (stable git history, no rename churn); folders still work for `ls`/browsing; agents can't desync content by moving files since the real file is always in the same place; symlink moves are cheap and atomic
- **Cons:** git tracks symlinks as text blobs (content is the target path) — GitHub renders them as small text files, not the actual markdown; Windows compatibility is poor (symlinks require admin or dev mode); some editors/tools don't follow symlinks transparently; `git log --follow` doesn't track through symlinks; adds a layer of indirection that can confuse new contributors
- **Questions:** does this actually solve the desync? The symlink-in-folder can still disagree with the engine snapshot — it just makes the disagreement cheaper to fix. Does the browsing benefit justify the symlink complexity vs just using `aigon board` or the dashboard?

### Option D: Folders as the authority, engine derives from them

- Reverse the current direction — scan folders to determine state
- Engine snapshot becomes a cache, rebuilt from folder position
- **Pros:** git is the source of truth (familiar); no desync possible
- **Cons:** loses the event-sourced history; can't enforce lifecycle rules (anyone can `git mv` to skip stages); XState machine becomes advisory only

## Findings

### Agent Agreement

All three agents (CC, GG, CX) agree on the fundamentals:

1. **The desync problem is structural, not a bug.** Dual-authority state (engine + folders) is a textbook anti-pattern in event-sourced systems. Projections must be read-only.
2. **Option C (reconcile on read) is insufficient.** Aigon already has repair/bootstrap logic and drift still escaped — formalizing what already fails won't help.
3. **Option D (folders as authority) must be rejected.** It throws away the core value of workflow-core: enforced lifecycle transitions, event-sourced recovery, action derivation.
4. **Option E (symlinks) must be rejected.** Portability issues (Windows, GitHub rendering), doesn't solve the core authority problem, adds indirection complexity.
5. **The codebase is already 70% toward engine-only authority.** Spec resolver prefers engine state, `move_spec` effect exists, snapshot adapters exist. The gap is enforcement.
6. **External tools confirm single-authority is the right pattern.** git-bug, Terraform, Linear, Kiro, SpecKit all use one authority with derived views. GitHub Projects is the only tool with a similar dual-authority pain — and it's a known unsolved problem there.

### Key Disagreement: Option A vs Option B

| | CC | GG | CX |
|---|---|---|---|
| **Primary recommendation** | Option B | Option A | Option B |
| **Rationale** | Folders provide genuine browsing value; enforcement (not removal) solves desync | Folders are a legacy crutch now that dashboard/board exist; flat structure is simplest | Option B is lowest-risk next step; Option A is a viable later simplification |
| **Option A as future step?** | Not worth the cost | N/A (primary choice) | Yes, after authority is centralized |

**Synthesis:** CC and CX both recommend Option B now with Option A as a possible later simplification. GG argues for Option A directly, reasoning that `aigon board` and the dashboard make folder browsing redundant. The pragmatic path is Option B: it solves the authority problem with lower migration risk, preserves folder browsing ergonomics, and leaves the door open for flattening later if folders prove to be unnecessary overhead.

### Migration Surface (from CC's analysis)

The codebase changes needed are well-scoped:
- `lib/commands/setup.js` — stop bootstrapping snapshots from folder position
- `lib/board.js` — replace `fs.readdirSync()` folder scanning with engine queries
- `lib/dashboard-status-collector.js` — replace `listStageSpecFiles()` with engine-based listing
- `lib/feature-spec-resolver.js` — already prefers engine; remove folder fallback
- `lib/commands/misc.js` — repair should reconcile engine→folder, never folder→engine

### Feedback Entity

All agents agree feedback needs a single authority too, but it's a separate concern:
- CC: feedback can remain folder-based for now since it has no second authority to desync with; add workflow-core later
- CX: either add minimal workflow-core or move to explicit status metadata; don't leave it as the one remaining folder-only subsystem long-term
- GG: apply flat-structure pattern to feedback for consistency

## Recommendation

**Adopt Option B: workflow-core as sole lifecycle authority, folders as derived read-only projection.**

This is the right call because:
1. It matches the existing design intent — the architecture was always heading here
2. The migration surface is manageable — most read paths already have engine-aware code
3. It solves the real incidents (features appearing in wrong columns) without a risky restructuring
4. It preserves folder browsing for humans while eliminating the desync class entirely
5. It leaves Option A (flat structure) available as a future simplification if folders prove unnecessary

## Output

### Selected Features

| Feature Name | Description | Priority |
|--------------|-------------|----------|
| single-source-1-engine-only-spec-transitions | Enforce that all spec file moves go through the workflow engine's `move_spec` effect. Auto-correct folder position when it disagrees with engine state. Remove bootstrap path that creates snapshots from folder position. | high |
| single-source-2-engine-based-read-paths | Migrate board and dashboard from folder scanning to engine snapshot queries. Remove `listStageSpecFiles()` and `fs.readdirSync()` folder scans from lifecycle display paths. | high |
| single-source-3-self-healing-spec-reconciliation | On dashboard/board refresh, compare engine state with folder position. Engine wins: move the file and log the correction. Replaces manual `aigon repair` for spec drift. | medium |
| single-source-4-feedback-single-authority | Give feedback entities a single lifecycle authority, consistent with features/research. Either minimal workflow-core or explicit status metadata with folders as derived projection. | low |

### Feature Dependencies
- single-source-2 depends on single-source-1
- single-source-3 depends on single-source-2
- single-source-4 depends on single-source-1

### Not Selected
- **flat-spec-layout / Option A** (GG recommended): revisit only after Option B is stable and we can evaluate whether stage folders still provide enough browsing value to justify the rename churn.
- **strict-manual-move-detection** (CX suggested): auto-correction in self-healing-spec-reconciliation makes detection-only warnings redundant.
