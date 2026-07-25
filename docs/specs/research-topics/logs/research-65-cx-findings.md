# Research Findings: git native team sync architecture

**Agent:** Codex (cx)
**Research ID:** 24
**Date:** 2026-04-14

---

## Key Findings

- `refs/aigon/*` is a good fit for numbering and board state. Local git experiments validated that custom refs can be pushed/fetched cleanly, are excluded from a normal `git clone`, can be fetched explicitly with a refspec, and are included by `git clone --mirror`.
- Bare git definitely supports the model. In a local bare remote, both `refs/aigon/features/42` and `refs/notes/aigon/claims` pushed and fetched normally.
- GitHub explicitly supports arbitrary fully-qualified refs. Its refs API accepts any fully qualified `ref` that starts with `refs` and has at least two slashes, and its matching-refs API says a full refs listing can include notes and stashes.
- GitHub and GitLab both advertise non-branch/tag namespaces over the git transport. `git ls-remote` against public repos returned `refs/pull/*`, `refs/notes/*`, and GitLab `refs/environments/*`, which is strong evidence that host-side transport is not limited to `refs/heads/*` and `refs/tags/*`.
- Bitbucket Cloud is the weakest host for this design. Atlassian's documented refs API only exposes branches and tags, so custom namespaces are at least not first-class in the API/UI. I did not have credentials to directly validate pushing a user-defined namespace there, so Bitbucket support remains transport-plausible but not fully validated.
- `git notes` works, but it is not the best primitive for locking. Notes can be pushed/fetched, and Git can copy them across amend/rebase when `notes.rewrite.<command>` and `notes.rewriteRef` are configured. But notes still introduce merge strategy concerns, are awkward to inspect, and create more moving parts than a singleton claim ref.
- A simpler lock is a singleton claim ref. `refs/aigon/claims/<entity>/<id>` can be created atomically on push. If the remote already has that ref, the claim fails without touching worktree files. This gives Aigon a real lock without note-merge semantics.
- Frontmatter-only attribution is not enough for claiming. It is review-friendly and human-readable, but claims would be serialized through PRs/commits, are not atomic, and reintroduce merge conflicts on the spec file. It is useful as a cached display field, not as the locking source of truth.
- `git log` exposure is manageable. Custom refs do not appear in default clone state. When decorations are enabled broadly, `log.excludeDecoration` cleanly hides `refs/aigon/*`; local tests confirmed that.
- Scale looks acceptable for hundreds of items. Fetching 600 custom refs from a local bare remote completed in about `0.24s` with low memory use. That is not a hosted-network benchmark, but it is enough to rule out obvious local scalability problems.
- Prior art points the same way: `git-bug` stores issue data as git objects rather than files and syncs through push/pull; `git-appraise` stores review metadata in `git notes` under tool-specific refs and relies on automatic note merging. The lesson is to keep workflow state out of normal tracked files and to choose refs/notes intentionally per use case.

## Proposed Architecture

### Refs

- Entity anchors:
  - `refs/aigon/features/<id>`
  - `refs/aigon/research/<id>`
  - `refs/aigon/feedback/<id>`
- Live claims:
  - `refs/aigon/claims/features/<id>`
  - `refs/aigon/claims/research/<id>`
  - `refs/aigon/claims/feedback/<id>`

### Semantics

- Prioritisation creates an immutable entity anchor ref at the current `HEAD`. That ref reserves the number and becomes the stable object Aigon can point at later.
- Starting work attempts to create the corresponding claim ref on the remote. Creation is the lock.
- Releasing work deletes the claim ref or updates it with `--force-with-lease` if Aigon wants an explicit handoff state.
- Spec frontmatter may mirror `assignee`, `claimed_at`, and `claimed_by` for readability, but the authoritative lock state lives in `refs/aigon/claims/*`.

### Claim Metadata

- Minimal viable schema if Aigon keeps a note or metadata object:
  - `schema_version`
  - `owner_name`
  - `owner_email`
  - `claimed_at`
  - `status`
- `entity_type` and `entity_id` should be inferred from the ref path, not duplicated.

### Why Not Notes As The Lock

- Notes are better for append-only annotations than for exclusive ownership.
- Lock acquisition should be "create ref if absent", not "read note, write note, push notes ref, maybe merge".
- If Aigon still wants audit/history, notes can be optional secondary metadata attached to the entity anchor or claim ref target.

## Sources

- GitHub refs API: https://docs.github.com/en/rest/git/refs?apiVersion=2022-11-28
- Git notes docs: https://git-scm.com/docs/git-notes
- Git config docs (`notes.rewriteRef`, `notes.displayRef`): https://git-scm.com/docs/git-config
- Git fetch docs (explicit refspecs): https://git-scm.com/docs/git-fetch
- git-bug README: https://github.com/git-bug/git-bug
- git-appraise README: https://github.com/google/git-appraise
- Local validation in this session:
  - Pushed/fetched custom refs and notes against a local bare repo
  - Verified default clone vs explicit fetch vs mirror behavior
  - Verified `log.excludeDecoration` hides `refs/aigon/*`
  - Measured fetch of 600 custom refs from a local bare remote (`~0.24s`)
  - Verified notes can be copied across `git commit --amend` with `notes.rewrite.amend=true` and `notes.rewriteRef=refs/notes/aigon/claims`

## Recommendation

Implement team sync around custom refs, not committed state files and not notes-first locking.

Recommended design:

1. Reserve entity numbers with immutable anchor refs in `refs/aigon/<type>/<id>`.
2. Claim work with singleton live refs in `refs/aigon/claims/<type>/<id>`.
3. Treat spec frontmatter as a human-readable cache only.
4. Make notes optional for audit/history, not required for lock correctness.
5. Define `aigon sync` as explicit metadata sync for Aigon refs:
   - `aigon sync fetch` fetches `refs/aigon/*`
   - `aigon sync push` pushes local Aigon refs created by this machine
   - `aigon sync status` compares local claim refs, remote claim refs, and current worktree state

I would not make Bitbucket Cloud a hard requirement for v1 unless it is directly validated with a disposable test repo. The architecture is strong for bare git and GitHub, and likely workable on GitLab, but Bitbucket is the one host where the evidence is weakest.

For the existing solo `aigon sync` from feature 254, I would fold both implementations under one command family with explicit backends rather than keep two unrelated `sync` concepts. Example:

- `aigon sync --backend local-state`
- `aigon sync --backend git-refs`

That keeps the CLI surface coherent while letting OSS ship the git-native team path as the default long-term direction.

## Suggested Features

<!--
Use the table format below. Guidelines:
- feature-name: Use kebab-case, be specific (e.g., "user-auth-jwt" not "authentication")
- description: One sentence explaining the capability
- priority: high (must-have), medium (should-have), low (nice-to-have)
- depends-on: Other feature names this depends on, or "none"
-->

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| git-native-team-sync | Replace paused committed-state team sync with a refs-based architecture for numbering, claiming, and board visibility across machines. Created at `docs/specs/features/01-inbox/feature-git-native-team-sync.md`. | high | none |
