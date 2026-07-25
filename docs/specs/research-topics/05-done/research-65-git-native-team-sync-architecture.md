# Research: git-native-team-sync-architecture

## Context

Aigon needs a multi-user team mode where developers on separate machines can see each other's feature/research assignments, prevent double-claiming, and keep board state in sync — all without requiring a central server or platform-specific APIs.

The multiuser feature series (250–253) was designed around committed state files with git push/pull. That approach has been paused because:
- Committed state files create merge conflicts between users
- The branch-switching dance (stash → checkout main → commit state → push → checkout feature → pop) is fragile
- It couples sync to the file format, making future changes expensive

An alternative proposal exists in `docs/aigon-distributed-git-native-task-tracking.md` using git's `refs/aigon/*` namespace and `git notes` for atomic claiming. This avoids file-level conflicts entirely but is unvalidated against real git hosting platforms.

This research should produce a validated architecture for team sync that can replace the paused 250–253 series with a single, well-designed implementation.

## Questions to Answer

- [ ] Do GitHub, GitLab, Bitbucket, and bare git repos all support pushing/fetching custom refs (e.g. `refs/aigon/features/42`)? What restrictions exist?
- [ ] Do GitHub, GitLab, Bitbucket support `git notes` push/fetch? Are there known issues with notes and rebase/squash workflows?
- [ ] What happens to `refs/aigon/*` refs during common git operations: clone, fork, mirror, shallow clone, GitHub "Download ZIP"?
- [ ] Is `refs/aigon/*` visible in `git log` output by default? Can it be hidden cleanly with `log.excludeDecoration`?
- [ ] Could assignee attribution live in spec frontmatter (e.g. `assignee: John <john@example.com>`) instead of refs/notes, using PRs as the sync mechanism? What are the tradeoffs vs. refs/notes?
- [ ] For the atomic claiming/locking use case, is there a simpler alternative to git notes? (e.g. lightweight tags in a custom namespace, or a single refs/aigon/claims branch with one-line JSON files)
- [ ] What's the performance profile of `git fetch origin refs/aigon/*` on a repo with 500+ features? Does it scale?
- [ ] How do existing tools (e.g. git-bug, git-appraise, git-dit) solve the distributed state problem? What can we learn from their approaches and failures?
- [ ] What's the minimal viable schema for a git note claim? (owner, email, timestamp, entity type, status)
- [ ] How should `aigon sync` work in the refs/notes world vs. the current `aigon sync` (which syncs `.aigon/` state via a separate private repo)?

## Scope

### In Scope
- Validating refs/notes feasibility across major git hosts
- Designing the refs namespace schema and note format
- Evaluating hybrid approaches (frontmatter for attribution, refs for locking)
- Defining the sync UX (`aigon sync` commands)
- Answering whether the existing solo `aigon sync` (feature 254) can coexist or should be replaced

### Out of Scope
- Platform-specific integrations (GitHub Actions, webhooks, PR automation) — these are Pro features
- Dashboard/UI design for team views
- Implementation — this research produces a spec, not code
- Cross-repo features (feature 702) — separate concern

## Inspiration
- `docs/aigon-distributed-git-native-task-tracking.md` — the refs/notes proposal
- Paused specs: features 250, 251, 252, 253 in `docs/specs/features/06-paused/`
- Research #30: multi-user-workflow-state-sync (prior research that informed the paused series)
- git-bug (https://github.com/git-bug/git-bug) — distributed bug tracker using git refs
- git-appraise — Google's distributed code review tool using git notes

## Prior Art: Distributed Git-Native Task Tracking Proposal

The following proposal was drafted as a starting point for this research. It outlines a decentralised, platform-agnostic system using git's internal reference system. **This is unvalidated — the research questions above exist to test these assumptions.**

### Core Architecture

To avoid cluttering the repository's standard branches and tags, all Aigon metadata is stored in a custom namespace: `refs/aigon/`. This ensures the data is synchronised but invisible to standard git commands.

Entity namespaces:
- Features: `refs/aigon/features/`
- Research: `refs/aigon/research/`
- Feedback: `refs/aigon/feedback/`
- Claims (Notes): `refs/notes/aigon/claims`

### Phase 1: The Numbering Lock (Prioritisation)

When a task file (e.g. `new-feature.md`) is prioritised, it is assigned a unique number.

Numbering algorithm:
1. Fetch latest metadata: `git fetch origin refs/aigon/*:refs/aigon/*`
2. Calculate next ID: list all refs in the specific entity namespace (e.g. `refs/aigon/features/*`), find the highest integer, and increment by 1
3. Reserve number: create a ref pointing to the current commit to "anchor" the number: `git update-ref refs/aigon/<type>/<number> HEAD`
4. Atomic push: `git push origin refs/aigon/<type>/<number>`
5. Conflict handling: if the push fails (e.g. Bob pushed #35 while Alice was calculating), the user must fetch and increment again
6. Apply identity: only after a successful push, rename the local file to `<number>-task-name.md`

### Phase 2: The Claiming Lock (Starting Work)

A "Claim" represents a single person starting work on a numbered task.

Claiming algorithm:
1. Fetch latest claims: `git fetch origin refs/notes/aigon/claims:refs/notes/aigon/claims`
2. Verify availability: check if a note already exists on the anchor ref: `git notes --ref aigon/claims show refs/aigon/<type>/<number>`
3. Atomic claim: if empty, add a claim note: `git notes --ref aigon/claims add -m "owner: <user_id>, status: started, timestamp: <now>" refs/aigon/<type>/<number>`
4. Synchronise: `git push origin refs/notes/aigon/claims`
5. Race condition: if the push is rejected, someone else claimed the task within the last few seconds. The user is notified and the local claim is aborted.

### CLI Requirements

- Configuration: automatically set `remote.origin.fetch` and `log.excludeDecoration` for the Aigon namespaces
- Commands: `aigon prioritize <filename>` (numbering + file rename), `aigon claim <number>` (git note claim + push), `aigon list <type>` (display tasks and owners)
- Portability: use standard git primitives to ensure it works on GitHub, GitLab, or private SSH servers

## Findings

See agent findings logs:
- `docs/specs/research-topics/logs/research-65-cc-findings.md` — thorough platform validation, schema design, prior art analysis
- `docs/specs/research-topics/logs/research-65-cx-findings.md` — local validation experiments, singleton claim refs proposal
- `docs/specs/research-topics/logs/research-65-gg-findings.md` — no findings produced

**Key consensus:** Custom refs (`refs/aigon/*`) are viable on all major platforms. Refs-based approach is superior to committed state files. Prior art (git-bug, git-appraise) validates the architecture while demonstrating pitfalls to avoid (never key notes to rebased commits).

**Key divergence:** CC recommends git notes with `cat_sort_uniq` for multi-operation claims; CX recommends singleton claim refs for simpler lock semantics. Both are valid — singleton refs are simpler for binary locking, notes are richer for operation logs.

## Recommendation

Implement refs-based team sync using:

1. **Custom refs for entity anchors** (`refs/aigon/features/<id>`, `refs/aigon/research/<id>`) — proven at scale by Gerrit, GitHub, and git-bug
2. **Atomic claiming via ref push** — first push wins, non-fast-forward rejection signals conflict. Start with singleton claim refs for simplicity; add notes-based audit log if needed later
3. **Hybrid frontmatter + refs** — refs are source of truth for claims, frontmatter is a human-readable cache updated after claim succeeds
4. **Auto-configured refspecs** during `aigon init --team` — fetch refspecs and `log.excludeDecoration` so aigon refs sync automatically but stay invisible in normal git usage
5. **Platform targets:** bare git and GitHub fully supported; GitLab best-effort; Bitbucket not required for v1

Key risks: every clone needs refspec configuration (handled by `aigon init`), forks start without aigon refs (handled by fetch-on-demand).

## Output

### Selected Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| git-native-team-sync | Refs-based team sync with entity anchors, atomic claiming, and `aigon init --team` setup. Replaces paused 250-253 | high | none |
| refs-state-backend | Update `aigon board` and dashboard to read state from git refs instead of .aigon/ files | medium | git-native-team-sync |
| stale-claim-recovery | Force-claim for recovering from crashed agents with `--force` and audit trail | medium | git-native-team-sync |
| frontmatter-claim-sync | Update spec frontmatter `assignee` after atomic claim succeeds for human visibility | low | git-native-team-sync |

### Feature Dependencies

- refs-state-backend depends on git-native-team-sync
- stale-claim-recovery depends on git-native-team-sync
- frontmatter-claim-sync depends on git-native-team-sync

### Not Selected

- dotaigon-refs-migration: No existing sync system to migrate from — the refs-based system is greenfield, not a migration
- aigon-init-team-setup: Merged into git-native-team-sync (inseparable from core implementation)
- atomic-claim-workflow: Merged into git-native-team-sync (inseparable from core implementation)
- aigon-board-refs-backend: Merged with dashboard into refs-state-backend
