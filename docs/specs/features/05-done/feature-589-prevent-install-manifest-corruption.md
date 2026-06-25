---
complexity: high
# agent: cc    # optional — id of the agent that owns this spec. Used as the
#              #   default reviewer for spec-revise cycles when the operator
#              #   does not pick one explicitly. Precedence at revision time:
#              #     event payload nextReviewerId > frontmatter agent:
#              #     > snapshot.authorAgentId > getDefaultAgent().
# research: 44 # optional — id (or list of ids) of the research topic that
#              #   spawned this feature. Stamped automatically by `research-eval`
#              #   on features it creates. Surfaced in the dashboard research
#              #   detail panel under Agent Log → FEATURES.
# planning_context: ~/.claude/plans/your-plan.md  # optional — path(s) to plan file(s)
#              #   generated during an interactive planning session (e.g. EnterPlanMode).
#              #   Content is injected into the agent's context at feature-do time and
#              #   copied into the implementation log at feature-start for durability.
#              #   Set this whenever you ran plan mode before writing the spec.
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-25T01:26:19.519Z", actor: "cli/feature-prioritise" }
---

# Feature: prevent-install-manifest-corruption

<!-- Authoring AI: set `complexity:` using this rubric before writing the spec:
       low       — config tweaks, doc-only, single-file helpers, trivial bug fixes
       medium    — standard feature with moderate cross-cutting, one command handler, small refactor
       high      — multi-file changes, new public surfaces, judgment-heavy deletion work
       very-high — architectural shifts, contract-breaking changes, new invariants, cross-cutting work that spans multiple subsystems
     At start time, model and effort defaults come from each agent's complexity-defaults
     table (not from this spec). Do not put model IDs in the spec. -->

## Summary
Two guardrails to close the failure mode behind F423-class incidents (`.aigon/install-manifest.json` corrupted by an unresolved git stash-pop conflict, silently undetected until a user hit a hard error on the dashboard Sync button).

**Guardrail 1 — stop tracking the manifest in git.** The manifest is pure derived metadata, already self-healing from disk (`readManifestRecovering` backs up invalid JSON; `synthesizeManifestFromDisk` can rebuild it in `lib/install-manifest.js`). It must not go through three-way merge or stash-pop. Today, fresh target repos get an unignored manifest and both `install-agent` (~`lib/commands/setup-legacy.js:1023`) and `apply` (~`:1638-1647`) include it in git staging/commit hints. Precedent for keeping `.aigon/` runtime files out of git noise: `ensureLocalGitExclude` in `lib/commands/setup/gitignore-and-hooks.js` (also used from seed-reset at ~`:5100-5113` for `.aigon/state/`, etc.). **Note:** the aigon OSS dogfood repo currently commits the manifest for F502 release lockstep (`scripts/check-install-manifest-clean.js`); this feature must untrack it there too and migrate that guard to compare installed file trees without requiring a committed manifest blob.

**Guardrail 2 — gate the multi-repo version sweep.** `printMultiRepoVersionSweep()` in `lib/commands/setup-legacy.js` (~`:2645-2713`) queues an `apply` fix for every stale repo in `~/.aigon/ports.json`. With `doctor --fix --yes`, `batchFix` runs the whole `fixQueue` via `runFixDispatch` (~`:4443-4447`) with no extra consent — a wide, non-obvious blast radius for a flag framed as "fix problems in this repo". This exact behavior turned an isolated test mistake into real working-tree changes in three unrelated repos during the incident that prompted this spec.

## User Stories
- [ ] As a user, I never want a git stash-pop conflict to leave `.aigon/install-manifest.json` corrupted, because it's derived state that shouldn't be subject to merge conflicts at all.
- [ ] As a user, I want `doctor --fix --yes` (or any single-repo command) to never silently mutate *other* registered repos without telling me which ones and letting me opt out.

## Acceptance Criteria
- [ ] `.aigon/install-manifest.json` is excluded from git in newly-installed repos via `ensureLocalGitExclude` (or the same local-exclude path seed-reset uses) — not by editing the user's `.gitignore` unless no git repo exists and Aigon already creates one for other entries.
- [ ] `install-agent` and `apply` no longer include `.aigon/install-manifest.json` in their git-add / commit-suggestion path lists (`installPaths` ~`:1023`, `aigonPaths` ~`:1638-1647`).
- [ ] A new migration (next version after `2.68.0` in `lib/migration.js`) runs on `doctor --fix` / `apply`: for repos where the manifest is git-tracked, `git rm --cached .aigon/install-manifest.json` (working-tree file stays; add local exclude if missing). Idempotent when already untracked.
- [ ] After migration + exclude, injecting `<<<<<<< Updated upstream` conflict markers into the on-disk manifest cannot reproduce a git merge conflict on that path (file is not tracked).
- [ ] `lib/install-manifest.js` callers (`readManifest`, `readManifestRecovering`, `getModifiedFiles`, `getMissingFiles`, `remove`) behave correctly when the manifest is untracked — confirm with tests; no caller may assume git tracking.
- [ ] F502 release lockstep still works without a committed manifest: update `scripts/check-install-manifest-clean.js` (and any related prepublish/CI checks) to diff installed file trees + semantic manifest content from a fresh `install-agent --all`, not `git show HEAD:.aigon/install-manifest.json`. The aigon repo itself is untracked for the manifest after migration.
- [ ] `doctor --fix --yes` does **not** run `aigon apply` in repos other than `process.cwd()` unless `--sweep-repos` is also passed.
- [ ] `doctor --fix` (without `--yes`) may list stale repos in the sweep section but must prompt before cross-repo `apply` (consistent with `deferFix` / `runFixDispatch` elsewhere).
- [ ] `doctor --fix --yes --sweep-repos` prints the full repo list (name + path + version) it will touch, then runs `apply` in each stale registered repo — same `spawnSync('aigon', ['apply'], { cwd })` as today.
- [ ] Single-repo `doctor --fix --yes` behavior for all non-sweep fixes is unchanged.
- [ ] `npm run test:core` passes; extend `tests/integration/install-manifest.test.js` (or add a sibling) for: fresh install excludes manifest from git status; migration untracks a previously committed manifest; sweep fix is skipped without `--sweep-repos` when `batchFix` is true.

## Validation
```bash
npm run test:core
```

## Technical Approach

### Execution order
1. **Guardrail 1** — local exclude on install/apply; strip manifest from commit hints; migration `git rm --cached`; update F502 prepublish guard; docs that tell users to commit the manifest.
2. **Guardrail 2** — gate `queueFix` in `printMultiRepoVersionSweep` behind `--sweep-repos` when `batchFix`; keep interactive prompt on `deferFix`.
3. **Tests** — integration coverage for both guardrails; run `test:core`.

### Guardrail 1 (untrack the manifest)
- Add `.aigon/install-manifest.json` to the `ensureLocalGitExclude` entry list on `install-agent`, `apply`, and the seed-reset exclude block (~`:5105-5112`) so new and reset repos pick it up without `.gitignore` edits.
- Migration `2.69.0` (or next available): if `git ls-files --error-unmatch .aigon/install-manifest.json` succeeds, run `git rm --cached` and ensure local exclude; log outcome; no-op when not a git repo or already untracked.
- Verify `lib/install-manifest.js` callers read disk only (they do today).
- Update maintainer docs/skills that say `git add .aigon/install-manifest.json` (`CONTRIBUTING.md`, `.claude/skills/release/SKILL.md`, site reference pages as needed).

### Guardrail 2 (gate the sweep)
- Parse `--sweep-repos` in the `doctor` handler alongside existing flags (`--fix`, `--yes`).
- In `printMultiRepoVersionSweep`, when building the stale-repo `queueFix` item (~`:2690-2704`): if `batchFix && !sweepReposFlag`, do **not** queue the cross-repo `apply` fix (still report stale repos as issues). When `sweepReposFlag` or interactive `deferFix`, queue as today; print enumerated repo list before `apply`.
- Do not change version comparison or `readRegisteredReposForVersionSweep` source (`~/.aigon/ports.json`).

## Dependencies
-

## Out of Scope
- Auto-resolving git stash-pop conflicts in general (e.g. teaching `restoreAutoStash()` in `lib/feature-close.js` to recognize conflicts on other derived tracked files). Guardrail 1 makes this moot for `install-manifest.json`; revisit separately if other derived files need the same treatment.
- Changing what the dashboard "SYNCED" badge reflects (version-match, not manifest health).
- Rewriting git history to remove past committed manifests — migration stops future tracking only.
- Untracking other derived `.aigon/` files (e.g. `.aigon/version`, `applied-digest`) in this pass — scoped to `install-manifest.json` only.

## Open Questions
- *(Resolved in review)* Sweep gate: `--sweep-repos` required for non-interactive cross-repo apply; `doctor --fix` without `--yes` keeps the existing prompt path.
- *(Resolved in review)* History rewrite: out of scope — `git rm --cached` only.
- *(Resolved in review)* Other derived `.aigon/` files: out of scope for this feature.
- *(Resolved in review)* One feature vs two: keep combined — same incident, independently testable guardrails, small enough for one implementation pass.

## Related
- F422 — install-manifest tracked files (introduced committed manifest pattern)
- F502 — template install drift guard (prepublish lockstep depends on committed manifest today)
- F423 — brewboard seed refresh (manifest lifecycle; noted manifest should be gitignored in seeds)
