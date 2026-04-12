# Research Findings: Multi-User Workflow State Sync

**Agent:** Claude (cc)
**Research ID:** 30
**Date:** 2026-04-12

---

## Key Findings

### 1. Feasibility and Design

**Which state files can be committed safely?**

State divides cleanly into two categories:

| File | Committable? | Rationale |
|------|-------------|-----------|
| `events.jsonl` | Yes | Deterministic, append-only, authored by the feature owner |
| `snapshot.json` | Yes (derived) | Can be regenerated from events, but committing avoids replay cost |
| `review-state.json` | Yes | Review lifecycle is meaningful to other users |
| `stats.json` | Yes | Cost/telemetry data is interesting for team visibility |
| Agent status files | **No** | Machine-local ephemeral state (running PID, worktree path) |
| Heartbeat files | **No** | Touch-based liveness — meaningless once pushed |
| Lock files | **No** | Inherently machine-local mutual exclusion |

The line is: **anything that describes lifecycle decisions** gets committed. **Anything that describes machine state** stays gitignored.

**Co-location structure**

Three options evaluated:

**(a) `state/` subdirectory inside the spec folder:**
```
docs/specs/features/03-in-progress/feature-42-auth/
├── feature-42-auth.md          # spec
└── state/
    ├── events.jsonl
    ├── snapshot.json
    ├── review-state.json
    └── stats.json
```
Pros: Spec + state move atomically with `git mv`. Clear ownership. One `git add` captures everything.
Cons: Breaks the current "one .md file per spec folder" assumption. Requires changing `getSpecPath()` to look for directories, not just files. Some spec folders are flat files today (e.g., `feature-add-fast-mode.md` with no enclosing directory).

**(b) Sibling files next to the spec:**
```
docs/specs/features/03-in-progress/feature-42-auth.md
docs/specs/features/03-in-progress/feature-42-auth.events.jsonl
docs/specs/features/03-in-progress/feature-42-auth.snapshot.json
```
Pros: No directory structure change needed.
Cons: Sibling files must be moved individually — easy to forget one. Clutters the spec directory listing.

**(c) Keep `.aigon/workflows/` but commit it:**
Pros: Minimal code changes — just remove gitignore lines.
Cons: State and spec are decoupled — they can get out of sync during moves. Two separate `git mv` operations needed. Doesn't achieve the stated goal of "spec + state travel as one unit."

**Recommendation: Option (a)** with a migration that converts flat spec files to directories. This is the cleanest long-term design. The current `getSpecPath()` / `computeSpecPath()` in `lib/workflow-core/paths.js` already searches directories — the change is to look for a `state/` subdirectory within them.

**How do spec folder moves work with co-located state?**

`git mv` handles directory moves atomically — moving `docs/specs/features/03-in-progress/feature-42-auth/` to `05-done/` moves all contents. The current code uses `fs.rename()` (not `git mv`), which also moves directories atomically. The `stagePaths()` function in `lib/commands/feature.js` would need to `git add` the new location and `git rm` the old — but this is already how it works for spec files. No fundamental issue here.

**What happens to locks?**

Locks stay gitignored in `.aigon/locks/`. For multi-user, the lock's purpose changes: it prevents concurrent *local* writes to the same event log. Since two users work on *different* features (stated constraint), local locks are sufficient. Cross-user contention is handled by git's push rejection (see §3 below).

**Divergent event logs**

If two users somehow push conflicting events for the same feature (violating the "distinct features" constraint), git will report a merge conflict on `events.jsonl`. Since JSONL is line-based, two appends at the end will conflict. Resolution: the constraint is enforced by the claiming mechanism (see §4). If it's somehow violated, manual conflict resolution is required — but this should be treated as an error, not a normal flow.

### 2. Git and Merge Behaviour

**What merge conflicts arise?**

With the "distinct features" constraint and co-location (option a), conflicts are **extremely unlikely**:
- Each feature's state lives in its own directory
- Two users editing different features' state = different files = no conflict
- The only shared file is the spec directory listing itself, which git handles as directory operations

The **one conflict risk** is if two users both move different features into the same stage directory in the same commit. Git handles directory additions without conflict — two new directories in the same parent merge cleanly. The risk is effectively zero.

**Commit noise**

Every workflow transition (start → implementing → evaluating → done) generates a state change. With 5-10 features active, this could mean 3-5 state commits per feature lifecycle.

Mitigation strategies:
1. **Batch state commits**: Don't commit on every transition. Commit on significant transitions only: `start`, `submitted`, `close`. Status polling and heartbeats never commit.
2. **Dedicated commit prefix**: Use `chore(state):` or `aigon:` prefix so state commits are easily filtered in `git log`.
3. **Squash on merge**: If features use branches, state commits squash into the feature merge commit.

Estimated noise: **2-4 state commits per feature lifecycle** with batching. Acceptable for any team.

**Automated vs manual state commits?**

Recommended: **Semi-automated**. `aigon feature-start`, `aigon feature-submit`, and `aigon feature-close` auto-commit state changes. Intermediate transitions (agent status updates, heartbeats) do NOT commit. An explicit `aigon sync` command is available for manual push.

This avoids the Terraform antipattern (every operation commits → noise explosion) while ensuring the important transitions are captured.

**Interaction with feature branches**

Two approaches:
1. **State on main only**: All state lives on main. Feature branches contain only code. When a feature is started, state is committed to main. When code is merged, state is updated on main.
2. **State travels with the branch**: State is committed on the feature branch and merged with the code.

**Recommendation: State on main.** Rationale: state represents the project board (who's working on what, what stage each feature is in). This is meaningful to all users immediately, not just when a branch merges. If state is on a branch, User B can't see that User A started feature-42 until the branch merges — which defeats the purpose.

### 3. Workflow Engine Changes

**Changes to `lib/workflow-core/`:**

The path module (`lib/workflow-core/paths.js`) is the **single point of change**. Currently:
```
getEntityRoot(repoPath, 'features', '42') → '.aigon/workflows/features/42'
```

Needs to become:
```
getEntityRoot(repoPath, 'features', '42') → 'docs/specs/features/03-in-progress/feature-42-auth/state'
```

This requires knowing the current lifecycle stage to find the spec directory. The `getSpecPathForEntity()` function already does this search — it scans all stage directories for the matching feature prefix. The state path derives from it:
```js
function getEntityRoot(repoPath, entityType, entityId) {
  const specDir = findSpecDirectory(repoPath, entityType, entityId);
  return path.join(specDir, 'state');
}
```

**Impact on other modules:**
- `lib/workflow-snapshot-adapter.js`: No changes needed if `getEntityRoot` returns the right path — it reads `snapshot.json` from the entity root.
- `lib/workflow-core/engine.js`: `resetFeature()` calls `rmSync` on the entity root. With co-location, this deletes the `state/` subdirectory. The spec file is preserved.
- `lib/workflow-core/lock.js`: Lock path changes from `.aigon/workflows/{id}/lock` to `.aigon/locks/{id}` (stays gitignored).

**`aigon doctor --bootstrap`:**

Currently creates workflow state for specs that have no `.aigon/workflows/{id}/` directory. With co-location, it checks for a `state/` subdirectory inside each spec folder. Logic is the same — just a different path. Already-committed state (pulled from another user) would be detected and skipped.

**`feature-reset`:**

Currently deletes `.aigon/workflows/features/{id}/` recursively. With co-location, it deletes the `state/` subdirectory inside the spec folder. Since state files are committed, `feature-reset` would need to:
1. Delete local state files
2. `git rm` the state directory
3. Commit: `chore(state): reset feature-42`
4. Move spec back to `02-backlog/`

This is a commit-producing operation, which is a behavior change from today (where reset is purely local). Acceptable — the reset should be visible to other team members.

### 4. Feature Claiming and Lightweight Locking

**Simplest claim mechanism: `claimed-by` field in the state file**

When `aigon feature-start 42` runs:
1. Read `git config user.name` and `git config user.email`
2. Write `state/claim.json`: `{ "user": "Alice <alice@co.com>", "at": "2026-04-12T10:00:00Z" }`
3. Commit: `chore(state): claim feature-42 [Alice]`
4. Push to remote

If another user tries `aigon feature-start 42`:
1. Check for `state/claim.json` in the spec directory
2. If present and `user` ≠ current git user → hard block: "Feature 42 is claimed by Alice. Use `--force` to override."
3. If `git push` fails (non-fast-forward because someone else pushed a claim first) → pull, detect conflict, report: "Someone else just claimed this feature."

**Race condition handling:**

Two users both run `feature-start 42` before either pushes. Both create `claim.json` locally. First push succeeds. Second push fails (non-fast-forward). On pull, git reports a merge conflict on `claim.json`. The second user sees: "Feature 42 was just claimed by Alice. Your claim was rejected."

This is **sufficient** for small teams (2-5 people). Git's push rejection IS the lock. No external service needed.

**How users see claims:**

- `aigon board`: Show "👤 Alice" next to claimed features
- Dashboard: Show user initials/avatar on board cards (via `claim.json` data)
- `aigon feature-info 42`: Show claim status

**Releasing claims:**

- Automatic on `feature-close` and `feature-reset` (delete `claim.json`, commit)
- Explicit `aigon feature-unclaim 42` for manual release
- No timeout-based expiry (too complex, wrong for async workflows)

**Event log audit trail:**

Yes — record `feature.claimed { user, timestamp }` in `events.jsonl`. This provides audit history without adding complexity. The `claim.json` file is the source of truth for the current claim; events are history.

**Fleet mode interaction:**

Fleet mode (multiple agents on one feature) is single-user by definition — one person runs multiple agents. The claim is per-user, not per-agent. A claimed feature can have multiple agents, all belonging to the claiming user. Multi-user Fleet on the same feature is explicitly out of scope.

### 5. Git Host Independence

**Core sync: pure git, no platform APIs required**

All state sync operations use only:
- `git add`, `git commit`, `git push`, `git pull`, `git fetch`
- Merge conflict detection (automatic in git)
- File creation/deletion (claim files, state files)

These work identically on GitHub, GitLab, Bitbucket, Gitea, bare repos over SSH, and shared filesystem remotes. No platform-specific API is needed for the core workflow.

**Where platform APIs add value (optional layer):**

| Enhancement | Requires | Value |
|------------|----------|-------|
| PR creation on feature-close | GitHub/GitLab/Bitbucket API | Automate code review flow |
| Claim notifications | Webhooks or CI triggers | Alert team when features are claimed |
| Branch protection | Platform settings | Prevent direct pushes to main |
| Conflict detection | Platform merge checks | Catch issues before push |
| Team member discovery | Platform API | Auto-populate user list |

**Recommendation:** Platform layer should be **optional and pluggable** — not the adapter pattern from research-22 (too heavy), but a simple hook system: `aigon.config.json` can specify `onClaim`, `onClose` hooks that call platform-specific commands. The core logic never imports a platform SDK.

**Server-side enforcement:**

Not needed for core claiming. Git's conflict detection is sufficient for small teams. Branch protection rules can be *recommended* (protect `docs/specs/` on main so only clean merges land) but are not required.

### 6. Multi-User UX

**User identity:**

Git config (`user.name` / `user.email`) is the identity source. Currently, `lib/git.js` has no `getGitUser()` function — one needs to be added. This is the right choice:
- Already configured on every developer machine
- No additional auth setup
- Works with any git host
- Matches git commit authorship

**Dashboard changes:**

Currently, the dashboard shows AI agent assignments (cc, gg, cx) but no human ownership. Changes needed:
- Board cards show the claiming user's name/initials (from `claim.json`)
- Color-coding or avatars to distinguish "my features" from others'
- A filter toggle: "Show all" / "Show mine"
- Feature detail view shows claim history from events

**Pulling new state:**

When User B runs `git pull` and gets new state for features they don't own, the dashboard simply shows it. No special handling needed — the snapshot adapter reads whatever state files exist on disk. This is the beauty of co-location: `git pull` is the sync mechanism, and the dashboard renders whatever is on disk.

**`aigon sync` command:**

Useful as a convenience wrapper:
```bash
aigon sync  →  git pull --rebase && git push
```
With pre-pull validation (stash uncommitted changes) and post-pull dashboard refresh. Not strictly necessary — `git pull` works — but reduces friction. Could also auto-commit any pending state changes before pulling.

### 7. Migration

**One-time migration script:**

```bash
aigon migrate-to-team
```

Steps:
1. For each feature with state in `.aigon/workflows/features/{id}/`:
   - Find the corresponding spec file/directory
   - Create `state/` subdirectory in the spec folder
   - Copy `events.jsonl`, `snapshot.json`, `review-state.json`, `stats.json`
   - Ensure spec is a directory (convert flat `.md` files to `{name}/spec.md`)
2. Update `.gitignore` — remove `.aigon/workflows/` (keep `.aigon/state/`, `.aigon/locks/`)
3. `git add` all new state files
4. Commit: `chore: migrate workflow state to committed co-location`
5. Delete old `.aigon/workflows/` files

**Coexistence during transition:**

Yes — during migration, the engine can check both locations: co-located state first, fallback to `.aigon/workflows/`. This allows gradual rollout. A `teamMode: true` flag in `aigon.config.json` controls which path is primary.

**Opt-in via config:**

`teamMode: true` in project config (`aigon.config.json`). When false (default), behavior is identical to today. When true:
- State paths resolve to co-located directories
- `feature-start` writes claim files
- State transitions auto-commit
- `aigon sync` command is available

### 8. Pro Positioning

**Clean OSS/Pro split:**

| Layer | Tier | Rationale |
|-------|------|-----------|
| State co-location (committed state) | OSS | Foundational — makes the rest possible |
| `teamMode` config toggle | OSS | Configuration plumbing |
| Claim mechanism (claim.json) | OSS | Basic mutual exclusion |
| `aigon sync` command | OSS | Convenience wrapper around git |
| Multi-user dashboard (team view, avatars, filters) | **Pro** | Visual feature, team-oriented |
| Platform hooks (PR creation, notifications) | **Pro** | Integration features |
| Team analytics (cross-user stats, velocity) | **Pro** | Reporting features |
| Conflict resolution UI | **Pro** | Advanced UX |

The OSS surface is: state relocation + claiming. Everything that makes it *pretty* or *integrated* is Pro. This follows the pattern: OSS = functional, Pro = delightful.

**Relation to PR workflow (research-pr-option):**

Highly complementary. Teams that sync state via git will want:
1. `feature-close` → auto-create PR (platform API, Pro)
2. PR merge → auto-update state (webhook, Pro)
3. PR review → feeds into eval workflow

The state sync mechanism is a prerequisite for the PR workflow. PR creation requires knowing which user owns the feature (from claim) and which branch has the code.

## Sources

- Terraform state management: https://developer.hashicorp.com/terraform/language/state/remote
- Pulumi state backends: https://www.pulumi.com/docs/concepts/state/
- git-bug (distributed bug tracking via git): https://github.com/MichaelMure/git-bug
- git-appraise (distributed code review): https://github.com/google/git-appraise
- Automerge CRDTs: https://automerge.org/
- Dolt (git-for-data): https://www.dolthub.com/
- Git merge behavior for JSONL: https://stackoverflow.com/questions/11770865
- Git transfer protocols (host independence): https://git-scm.com/book/en/v2/Git-Internals-Transfer-Protocols
- Aigon codebase: `lib/workflow-core/paths.js`, `lib/workflow-core/engine.js`, `lib/workflow-snapshot-adapter.js`, `lib/agent-status.js`, `lib/git.js`, `lib/dashboard-status-collector.js`

## Recommendation

**Implement multi-user state sync in three phases:**

**Phase 1 — State co-location (OSS):** Move workflow state into spec directories as `state/` subdirectories. Add `teamMode` config toggle. Convert flat spec files to directories. Update `lib/workflow-core/paths.js` path resolution. This is the foundation — everything else depends on it.

**Phase 2 — Claiming + sync (OSS):** Add `claim.json` mechanism to `feature-start`. Add `getGitUser()` to `lib/git.js`. Add `aigon sync` command. Auto-commit state on significant transitions. Add claim display to `aigon board`.

**Phase 3 — Team dashboard (Pro):** Multi-user board view with avatars/filters. Platform hooks for PR creation and notifications. Cross-user analytics. Conflict resolution UI.

The design is deliberately **git-native and host-independent**. No GitHub/GitLab API is required for core functionality. Platform-specific features are optional enhancements in the Pro tier.

The key architectural insight is: **git's push rejection IS the distributed lock**. No external locking service is needed. The "distinct features" constraint (each user works on different features) means merge conflicts on state files should never occur in normal usage. The claiming mechanism prevents accidental concurrent work.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| workflow-state-colocation | Move workflow state (events, snapshots) into spec directories as committed `state/` subdirectories | high | none |
| spec-directory-normalization | Convert flat spec `.md` files to directory format (`{name}/spec.md`) to support co-located state | high | none |
| team-mode-config | Add `teamMode` toggle to `aigon.config.json` that switches state paths from gitignored to committed | high | workflow-state-colocation |
| feature-claiming | Lightweight claim mechanism via `claim.json` with git user identity, auto-written on `feature-start` | high | workflow-state-colocation, team-mode-config |
| git-user-identity | Add `getGitUser()` to `lib/git.js` returning `{ name, email }` from git config | high | none |
| aigon-sync-command | `aigon sync` convenience wrapper: commit pending state, pull --rebase, push | medium | team-mode-config |
| state-auto-commit | Auto-commit state changes on significant transitions (start, submit, close) with `chore(state):` prefix | medium | workflow-state-colocation, team-mode-config |
| board-claim-display | Show claiming user's name/initials on `aigon board` output and dashboard cards | medium | feature-claiming |
| team-dashboard-view | Pro: multi-user board with avatars, "mine" filter, team activity feed | low | feature-claiming, board-claim-display |
| platform-hooks-pr | Pro: optional hooks for PR creation on feature-close via platform APIs (GitHub, GitLab, Bitbucket) | low | feature-claiming, aigon-sync-command |
| migrate-to-team-command | One-time `aigon migrate-to-team` script to move existing gitignored state to committed co-location | medium | workflow-state-colocation, spec-directory-normalization |
| cross-user-analytics | Pro: team velocity, cross-user cost reporting, feature throughput dashboards | low | team-dashboard-view |
