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
Two guardrails to close the failure mode behind F423-class incidents (install-manifest.json corrupted by an unresolved git stash-pop conflict, silently undetected until a user hit a hard error on the dashboard Sync button). (1) Stop tracking `.aigon/install-manifest.json` in git entirely — it's pure derived metadata, already fully self-healing from disk (see `synthesizeManifestFromDisk` in `lib/install-manifest.js`), so it should never go through a three-way merge or stash-pop in the first place; removing it from version control eliminates the entire corruption class rather than just this instance of it. (2) Gate the "Multi-Repo Version Sweep" inside `doctor --fix --yes` (`lib/commands/setup-legacy.js` ~line 2660-2713) behind explicit confirmation — today it silently runs a real `aigon apply` against *every* registered repo in `~/.aigon/config.json` whenever any are behind the current CLI version, which is a wide, non-obvious blast radius for a flag framed as "fix problems in this repo" (this exact behavior turned an isolated test mistake into real working-tree changes in three unrelated repos during the incident that prompted this spec).

## User Stories
- [ ] As a user, I never want a git stash-pop conflict to leave `.aigon/install-manifest.json` corrupted, because it's derived state that shouldn't be subject to merge conflicts at all.
- [ ] As a user, I want `doctor --fix --yes` (or any single-repo command) to never silently mutate *other* registered repos without telling me which ones and letting me opt out.

## Acceptance Criteria
- [ ] `.aigon/install-manifest.json` is gitignored going forward for newly-installed repos (via whatever Aigon's install path uses to manage its own `.aigon/`-internal ignore rules — not the user's general `.gitignore`, per the target-repo-zero-opinion boundary in `AGENTS.md`).
- [ ] Existing repos that already have `install-manifest.json` tracked/committed are migrated cleanly (e.g. a new migration that runs `git rm --cached` for the path, or equivalent) — without deleting the working-tree file, and without breaking `getModifiedFiles`/`getMissingFiles` callers that assume the file is present on disk.
- [ ] After the change, a repeat of this session's reproduction (inject `<<<<<<< Updated upstream` markers into the manifest, as a stash-pop conflict would) can no longer happen via git, because git no longer tracks the file.
- [ ] `doctor --fix --yes`'s multi-repo version sweep prints the full list of repos it intends to touch and requires explicit confirmation (or an explicit opt-in flag, e.g. `--sweep-repos`) before running `aigon apply` in any repo other than the current one.
- [ ] Existing single-repo `doctor --fix --yes` behavior (fixing issues in the current repo only) is unchanged and still requires no extra flag.
- [ ] `npm run test:core` passes; add/extend coverage for both guardrails (manifest-ignored-on-fresh-install, migration untracks an already-committed manifest, sweep refuses to run without confirmation/flag).

## Validation
<!-- Optional: commands the iterate loop runs after each iteration (in addition to project-level validation).
     Use for feature-specific checks that don't fit in the project's general checks.
     All commands must exit 0 for the iteration to be considered successful.
     Leave the block below empty or remove it if there is nothing feature-specific to run. -->
```bash
```

## Technical Approach
Guardrail 1 (untrack the manifest): add the path to whatever mechanism Aigon already uses to keep its own `.aigon/`-internal files out of the user's `git status` noise (check existing patterns before inventing a new one — `applied-digest`, `cache/`, etc. may already have a precedent). Write a migration (next available version after the current head) that, for repos where the file is currently tracked, runs `git rm --cached .aigon/install-manifest.json` (working tree file stays untouched) so existing repos transition cleanly on their next `apply`. Verify `lib/install-manifest.js` callers (`readManifest`, `readManifestRecovering`, `getModifiedFiles`, `getMissingFiles`) make no assumption that the file is git-tracked — they shouldn't, since they all read straight off disk, but confirm.

Guardrail 2 (gate the sweep): in the multi-repo version sweep block in `lib/commands/setup-legacy.js`, before calling `spawnSync('aigon', ['apply'], { cwd: row.path, ... })` for each stale repo, collect the full list first and print it, then require either an interactive confirmation (consistent with how other destructive batch operations in this CLI confirm) or a new explicit flag. Decide which based on whether `doctor --fix --yes` is meant to ever run non-interactively (e.g. in CI) — if so, the flag option is required for that use case to keep working; if not, a confirmation prompt is suffinient. This needs a decision from whoever picks this up (see Open Questions).

## Dependencies
<!-- Other features, external services, or prerequisites.
     For Aigon feature dependencies use: depends_on: feature-name-slug
     This enables ordering enforcement — dependent features can't start until deps are done. -->
-

## Out of Scope
- Auto-resolving git stash-pop conflicts in general (e.g. teaching `restoreAutoStash()` in `lib/feature-close.js` to recognize and auto-resolve conflicts on other derived/volatile tracked files). Considered and deprioritized in favor of guardrail 1, which makes this moot for `install-manifest.json` specifically; revisit separately if other derived files turn out to need the same treatment.
- Changing what the dashboard's "SYNCED" badge reflects (currently version-match, not manifest health) — out of scope here, though related: it's why a corrupted manifest can sit invisible behind a green badge until a user explicitly re-applies.

## Open Questions
- Should the multi-repo sweep gate be an interactive confirmation, a required `--yes`-compatible flag, or both (flag bypasses the prompt)? Needs a decision before implementation.
- For the untrack migration: should it also offer to delete the file from git history (e.g. via a one-time advisory message), or is leaving past commits alone (just stopping future tracking) sufficient? Recommend the latter — rewriting history is out of scope and risky.
- Does any other Aigon-managed file under `.aigon/` have the same git-tracked-but-fully-derived problem and deserve the same untracking treatment in this pass, or should this stay scoped to `install-manifest.json` only?

## Related
<!-- Links to research topics, other features, or external docs -->
- Research: <!-- ID and title of the research topic that spawned this feature, if any -->
- Set: <!-- set slug if this feature is part of a set; omit line if standalone -->
- Prior features in set: <!-- feature IDs that precede this one, e.g. F314, F315; omit if standalone -->
