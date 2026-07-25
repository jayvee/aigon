# Research Findings: git native team sync architecture

**Agent:** Claude (cc)
**Research ID:** 24
**Date:** 2026-04-14

---

## Key Findings

### Q1: Custom Refs Support Across Platforms

**`refs/aigon/*` works on all major platforms.** Confirmed by production usage of identical patterns (git-bug's `refs/bugs/*`, Gerrit's `refs/changes/*`, GitHub's `refs/pull/*`).

| Platform | Custom refs support | Blocked namespaces |
|----------|--------------------|--------------------|
| Bare git | Full native support | None |
| GitHub | Supported | `refs/pull/*` (read-only, managed by GitHub) |
| GitLab | Supported | `refs/merge-requests/*`, `refs/keep-around/*` (system-managed) |
| Bitbucket | Supported | `refs/pull-requests/*` (system-managed) |

**Ref name rules** (per `git-check-ref-format`): must contain at least one `/`, no `..`, no ASCII control chars, no `~^:?*[\`, no component starting with `.` or ending with `.lock`. `refs/aigon/features/42` passes all rules.

**GitLab caveat:** Repository mirroring does NOT support custom refspecs for upstream fetching ([Gitaly #2822](https://gitlab.com/gitlab-org/gitaly/-/issues/2822)). Mirrored repos won't auto-pull `refs/aigon/*`.

### Q2: Git Notes Push/Fetch Support

**Notes work on all platforms but require explicit refspec configuration.** Notes are NOT pushed/fetched by default.

```bash
git config --add remote.origin.fetch '+refs/notes/*:refs/notes/*'
git push origin refs/notes/aigon/claims
```

| Platform | Push notes | Fetch notes | UI display |
|----------|-----------|-------------|------------|
| GitHub | Yes (explicit) | Yes (explicit) | No (removed from web UI) |
| GitLab | Yes (explicit) | Yes (explicit) | Limited |
| Bitbucket | Yes (explicit) | Yes (explicit) | No |

**Critical: The rebase/squash orphaning problem.** Git notes are keyed by commit SHA. Rebase creates new SHAs, orphaning notes. `notes.rewriteRef` mitigates this locally but NOT for server-side squash-merge (GitHub/GitLab merge buttons).

**Mitigation:** The proposal's design of attaching notes to **anchor refs** (`refs/aigon/features/42`) rather than branch commits avoids this entirely. The anchor ref's target SHA is stable. This is the correct approach -- validated by git-appraise's failure when it keyed notes to branch commits.

### Q3: Custom Refs During Common Git Operations

| Operation | `refs/aigon/*` included? | Notes |
|-----------|------------------------|-------|
| `git clone` | **No** | Default refspec only fetches `refs/heads/*` + tags |
| `git clone --mirror` | **Yes** | Copies all refs (`+refs/*:refs/*`) |
| `git clone --bare` | **No** | Same as regular clone |
| `git fetch` (default) | **No** | Must add custom fetch refspec |
| `git fetch` (configured) | **Yes** | After adding `remote.origin.fetch` entry |
| GitHub Fork | **No** | Only branches and tags |
| Shallow clone | **No** | Even more restrictive |
| GitHub ZIP download | **No** | No git data at all |
| `git bundle --all` | **Yes** | Includes all refs from show-ref |

**Implication:** `aigon init` must configure the fetch refspec. This is a one-time setup per clone but is mandatory friction. New team members need to run setup before they can see team state.

### Q4: Visibility in `git log`

**`refs/aigon/*` is invisible in `git log --decorate` by default.** Git's default decoration filter only shows `HEAD`, `refs/heads/*`, `refs/tags/*`, `refs/remotes/*`. No configuration needed to hide aigon refs from normal log output.

**`git log --all` DOES walk commits reachable only via `refs/aigon/*`**, but still doesn't show them as decorations. This is a minor concern since aigon anchor refs typically point to commits also reachable from normal branches.

**Defensive config** (set during `aigon init`):
```ini
[log]
    excludeDecoration = refs/aigon/*
    excludeDecoration = refs/notes/aigon/*
```
This ensures hiding even if a user enables `log.initialDecorationSet = all`. The git-branchless project uses this exact pattern (`refs/branchless/*`).

**Git version note:** Requires git 2.36+ for `log.excludeDecoration`. Git 2.38 tightened the default decoration list, which works in our favor.

### Q5: Frontmatter Attribution vs. refs/notes

| Criterion | Frontmatter + PRs | refs/notes |
|-----------|-------------------|------------|
| Human readability | Excellent (visible in any editor) | Poor (requires `git notes show`) |
| Platform visibility | Full (GitHub file browser, diffs) | Minimal (GitHub removed notes UI) |
| Merge conflicts | Yes (concurrent edits conflict) | No (push rejection = conflict signal) |
| Atomic claiming | No (competing PRs race) | Yes (first push wins) |
| Tooling complexity | Low (YAML parser) | Medium (git notes + refspecs) |
| Platform dependency | Medium (relies on PR workflow) | Low (pure git protocol) |
| Claiming speed | Slow (branch + commit + PR + merge) | Fast (notes add + push) |
| Audit trail | Good (PR history) | Limited (notes overwritable) |

**Recommended hybrid approach:**
- **Frontmatter for human-readable attribution** (`assignee`, `status` in spec files) -- the permanent record humans see
- **refs/notes for atomic locking** -- the fast, conflict-free mechanism for real-time claiming
- The note acts as a short-lived lock; the frontmatter is the durable record

### Q6: Simpler Alternatives to Git Notes for Claiming

Four approaches evaluated:

**(a) Lightweight tags (`refs/tags/aigon/claim/42-john`):** Atomic push works, but pollutes the tags namespace -- tags appear in `git tag --list` and platform UIs. Not recommended.

**(b) Orphan branch with JSON files (`refs/aigon/claims` branch):** Familiar file-based model but suffers the SAME merge conflict issues as `.aigon/` committed state files. The fetch-merge-push dance is not atomic. Not recommended.

**(c) Custom refs pointing to blob objects:** Technically possible (verified experimentally -- `git update-ref` accepts blob SHAs). Atomic push semantics work. However, platform compatibility with blob-pointed refs is **uncertain** -- hosted platforms may reject non-commit refs. Needs empirical testing.

**(d) Custom refs pointing to lightweight commits (recommended):** Create a commit with the claim data as the commit message, using the empty tree as the tree. Universal platform compatibility. Atomic push. Built-in history via reflog.

```bash
EMPTY_TREE=$(git hash-object -t tree /dev/null)
CLAIM=$(echo '{"v":1,"op":"claim","owner":"john",...}' | git commit-tree $EMPTY_TREE)
git update-ref refs/aigon/claims/42 $CLAIM 0000000000000000000000000000000000000000
git push origin refs/aigon/claims/42  # fails if already exists
```

**However**, if multiple operations per entity are needed (claim -> start -> submit -> done), the notes-based approach with `cat_sort_uniq` merge is better because it supports append-only operation logs. Individual refs per claim only support single-value state.

**Final verdict:** Use **git notes with `cat_sort_uniq` for multi-operation claims** (operation log per entity), with notes keyed to stable anchor refs. Use **individual refs** only for entity registration (numbering/anchoring), not for claims.

### Q7: Performance at Scale (500+ Features)

**Git protocol v2** (default since Git 2.26+) makes custom ref fetching efficient:
- `ls-refs` command filters server-side with `ref-prefix` -- only matching refs are sent
- Fetching `refs/aigon/*` is **3 round-trips** regardless of ref count (connect + ls-refs + fetch)
- Google measured 3x speedup and 8x overhead reduction vs. v1 on repos with 500k refs

**500 features = ~2000 refs** (anchor + claim per feature/research/feedback). This is comparable to a moderately active GitHub repo's `refs/pull/*` namespace. Well within normal operating parameters.

**Reftable format** (Git 2.45+, 2024) provides near-constant-time ref lookups. Benchmarks: 1M refs created in 51.9s (reftable) vs 152.8s (files). Lookups 51% faster.

**500 refs vs. 500 files in a branch:** Refs win on every dimension -- zero merge conflicts, lower transfer overhead (refs point to existing commits, no new objects needed), hidden from working tree.

### Q8: Existing Tools -- Lessons Learned

| Tool | Approach | Status | Key lesson |
|------|----------|--------|------------|
| **git-bug** | Operation DAG under `refs/bugs/*` with Lamport clock CRDT | Active (9.7k stars, v0.10.1) | Append-only operations avoid all merge conflicts |
| **git-appraise** | Git notes under `refs/notes/devtools/*` | Abandoned (~2018) | Notes keyed to commit SHAs break on rebase |
| **git-dit** | Commits with git trailers | Abandoned (2017) | Simple model but no conflict resolution |
| **git-issue** | Files in `.issues/` directory | Active (870 stars) | File-based = standard merge conflicts |
| **Fossil SCM** | Immutable ticket artifacts | Mature | Best design, but not git-compatible |

**Six key lessons:**
1. **Append-only immutable operations work** -- never store mutable state (git-bug, Fossil)
2. **Never key notes to rebased commits** -- use stable anchors (git-appraise failure)
3. **Custom ref namespaces are production-proven** -- Gerrit, GitHub, git-bug
4. **Adoption requires good UX**, not just good data models (git-appraise, git-dit)
5. **Distributed issue tracking faces social resistance** -- justified only for offline-first, vendor-agnostic, or agent-coordination use cases
6. **Bridges to existing platforms are essential** for adoption

### Q9: Minimal Viable Claim Schema

Each claim operation is **one line of JSON** (enables `cat_sort_uniq` merge):

```json
{"v":1,"op":"claim","owner":"john","email":"john@example.com","ts":"2026-04-14T10:00:00Z","seq":1,"entity":"feature","status":"claimed","agent":"cc"}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `v` | int | yes | Schema version (1) |
| `op` | string | yes | `claim`, `release`, `transition` |
| `owner` | string | yes | User identifier |
| `email` | string | yes | User email (from git config) |
| `ts` | string | yes | ISO 8601 timestamp |
| `seq` | int | no | Lamport clock for deterministic ordering |
| `entity` | string | yes | `feature`, `research`, `feedback` |
| `status` | string | yes | `claimed`, `started`, `submitted`, `done`, `abandoned` |
| `agent` | string | no | Agent ID (`cc`, `cx`, `gg`) |
| `meta` | object | no | Extensibility (e.g., `{"force":true}`) |

**Status transitions:**
```
(none) -> claimed (claim op)
claimed -> started -> submitted -> done (transition ops, same owner)
claimed/started -> abandoned (release op)
abandoned -> claimed (re-claim by any user)
submitted -> started (rework, same owner)
```

### Q10: How `aigon sync` Should Work

**Refspec auto-configuration** (during `aigon init --team`):
```bash
git config --add remote.origin.fetch '+refs/aigon/*:refs/aigon/*'
git config --add remote.origin.fetch '+refs/notes/aigon/*:refs/notes/aigon/*'
git config --add log.excludeDecoration 'refs/aigon/*'
git config --add log.excludeDecoration 'refs/notes/aigon/*'
git config notes.aigon/claims.mergeStrategy cat_sort_uniq
```

**Commands:**
- `aigon sync pull` -- `git fetch origin refs/aigon/* refs/notes/aigon/*`
- `aigon sync push` -- push claim notes and anchor refs
- `aigon sync status` -- compare local vs remote refs
- `aigon claim <type> <id>` -- atomic fetch-check-claim-push cycle

**Conflict resolution:** Non-fast-forward push rejection = someone else claimed first. Fetch, check, report. `--force` flag for stale claim recovery with audit trail.

**Three-phase transition from `.aigon/` sync:**
1. **Parallel:** Both systems write, refs read preferred, `.aigon/` as fallback
2. **Refs-primary:** `.aigon/state/` becomes local cache only
3. **Deprecate:** Remove `.aigon/` sync, keep local config/logs

Key insight: `.aigon/config.json` and event logs remain useful locally. Only the cross-machine sync mechanism changes.

## Sources

### Platform Support & Refs
- [git-check-ref-format](https://git-scm.com/docs/git-check-ref-format)
- [Git Book - The Refspec](https://git-scm.com/book/en/v2/Git-Internals-The-Refspec)
- [GitHub REST API - Git References](https://docs.github.com/en/rest/git/refs)
- [GitHub Community - Deny Updating Hidden Ref](https://github.com/orgs/community/discussions/124685)
- [GitLab Gitaly Issue #2822 - Custom refspec mirroring](https://gitlab.com/gitlab-org/gitaly/-/issues/2822)
- [GitLab Keep-Around Refs](https://docs.gitlab.com/development/merge_request_concepts/keep_around_refs/)

### Git Notes
- [git-notes Documentation](https://git-scm.com/docs/git-notes)
- [Tyler Cipriani - Git Notes: git's coolest, most unloved feature](https://tylercipriani.com/blog/2022/11/19/git-notes-gits-coolest-most-unloved-feature/)
- [Alchemists - Git Notes (rebase orphaning)](https://alchemists.io/articles/git_notes)
- [Ken Muse - Storing Data in Git Objects With Notes](https://www.kenmuse.com/blog/storing-data-in-git-objects-with-notes/)

### Git Operations & Cloning
- [git-clone Documentation](https://git-scm.com/docs/git-clone)
- [git-bundle Documentation](https://git-scm.com/docs/git-bundle)
- [GitHub Blog - Partial and Shallow Clone](https://github.blog/open-source/git/get-up-to-speed-with-partial-clone-and-shallow-clone/)

### Performance & Protocols
- [Google - Introducing Git Protocol Version 2](https://opensource.googleblog.com/2018/05/introducing-git-protocol-version-2.html)
- [Git Protocol v2 Documentation](https://git-scm.com/docs/gitprotocol-v2)
- [Wikimedia - Faster fetches with protocol v2](https://phabricator.wikimedia.org/phame/post/view/199/faster_source_code_fetches_thanks_to_git_protocol_version_2/)
- [Reftable format documentation](https://git-scm.com/docs/reftable)
- [GitLab - Reftable beginner's guide](https://about.gitlab.com/blog/a-beginners-guide-to-the-git-reftable-format/)
- [Highlights from Git 2.45 - GitHub Blog](https://github.blog/open-source/git/highlights-from-git-2-45/)

### Existing Tools
- [git-bug](https://github.com/git-bug/git-bug) -- 9.7k stars, operation-based CRDT with Lamport clocks
- [git-bug data model](https://github.com/git-bug/git-bug/blob/master/doc/model.md)
- [git-appraise](https://github.com/google/git-appraise) -- Google, refs/notes/devtools/*
- [git-appraise rebase issue #45](https://github.com/google/git-appraise/issues/45)
- [git-dit](https://github.com/git-dit/git-dit) -- 465 stars, commits with trailers
- [git-issue](https://github.com/dspinellis/git-issue) -- 870 stars, file-based
- [Fossil bug tracking theory](https://fossil-scm.org/home/doc/trunk/www/bugtheory.wiki)

### Git Internals
- [Git Internals - Git Objects](https://git-scm.com/book/en/v2/Git-Internals-Git-Objects)
- [Git Internals - Git References](https://git-scm.com/book/en/v2/Git-Internals-Git-References)
- [git update-ref (compare-and-swap)](https://git-scm.com/docs/git-update-ref)
- [Git 2.4 - atomic pushes](https://github.blog/open-source/git/git-2-4-atomic-pushes-push-to-deploy-and-more/)
- [git-branchless issue #171 - log.excludeDecoration](https://github.com/arxanas/git-branchless/issues/171)

## Recommendation

The refs-based approach is **validated as technically sound and scalable**. The architecture should be:

1. **Custom refs for entity anchors** (`refs/aigon/features/<id>`, `refs/aigon/research/<id>`) -- proven at scale by Gerrit, GitHub, and git-bug. All major platforms support them.

2. **Git notes with `cat_sort_uniq` for claims** (`refs/notes/aigon/claims`) -- each claim is one line of JSON, append-only, merge-safe. Notes keyed to anchor refs (not branch commits) to avoid the rebase problem that killed git-appraise.

3. **Hybrid frontmatter + notes** -- human-readable `assignee` field in spec frontmatter for visibility, notes for atomic machine-speed claiming. Notes are the source of truth; frontmatter is updated after claiming succeeds.

4. **Auto-configured refspecs** during `aigon init --team` -- adds fetch refspecs and `log.excludeDecoration` so aigon refs are automatically synced but invisible in normal git usage.

5. **Phased transition** from `.aigon/` sync -- parallel operation first, then refs-primary, then deprecate `.aigon/` sync while keeping local config/logs.

6. **Versioned schema** with Lamport clock ordering -- forward-compatible, deterministic conflict resolution, auditable operation log.

**Key risks:**
- Git notes require push access (fine for private team repos; needs bridges for open-source)
- Every clone needs refspec configuration (one-time friction, handled by `aigon init`)
- Forks and fresh clones start without aigon refs (handled gracefully by fetch-on-demand)

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| refs-based-team-sync | Core implementation of refs/aigon/* namespace with git notes claims for distributed team coordination, replacing paused features 250-253 | high | none |
| aigon-init-team-setup | Auto-configure refspecs, log.excludeDecoration, and notes merge strategy during `aigon init --team` | high | refs-based-team-sync |
| atomic-claim-workflow | Implement fetch-check-claim-push cycle with non-fast-forward conflict detection and Lamport clock ordering | high | refs-based-team-sync |
| aigon-board-refs-backend | Update `aigon board` to read entity/claim state from refs/notes instead of .aigon/ files | medium | refs-based-team-sync |
| stale-claim-recovery | Force-claim mechanism for recovering from crashed agents with `--force` flag and audit trail in claim metadata | medium | atomic-claim-workflow |
| dotaigon-refs-migration | Three-phase migration tool: parallel operation, refs-primary, deprecate .aigon/ sync | medium | aigon-board-refs-backend |
| frontmatter-claim-sync | After atomic note claim succeeds, update spec frontmatter `assignee` field for human visibility | low | atomic-claim-workflow |
