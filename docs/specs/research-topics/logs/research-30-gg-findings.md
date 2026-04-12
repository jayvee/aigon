# Research Findings: multi user workflow state sync

**Agent:** Gemini (gg)
**Research ID:** 30
**Date:** 2026-04-12

---

## Key Findings

### 1. State Co-location and Committing Strategy
To enable multi-user visibility, feature state must travel with the feature spec as a single unit, and it must be committed to the repository.

*   **Committed State:** The `events.jsonl`, `snapshot.json`, and `review-state.json` can be safely committed. They are deterministic and represent the source of truth for the workflow.
*   **Gitignored State:** `heartbeat-*` files, `.aigon/locks/` mutexes, and `agent-status` files are too ephemeral and machine-specific. They should remain in `.aigon/state/` and `.aigon/locks/` and stay gitignored.
*   **Co-location Structure:** The best structure is a directory-per-feature model:
    `docs/specs/features/03-in-progress/feature-42-auth/`
    Inside this directory:
    *   `spec.md` (the feature spec itself)
    *   `state/events.jsonl`
    *   `state/snapshot.json`
    *   `state/claim.json` (new lightweight lock)
*   **Folder Moves:** Using `git mv` on the directory atomically moves the spec and its state from `02-backlog` to `03-in-progress` to `05-done`.

### 2. Pure-Git Lightweight Claiming
We need a way to prevent two users from working on the same feature, without requiring an external database or Jira integration.

*   **Mechanism:** When a user runs `aigon feature-start 42`, Aigon creates a `state/claim.json` file containing their `user.name` and `user.email` (from git config), commits it to the `main` branch, and attempts to `git push origin main`.
*   **Mutual Exclusion:** If two users try to claim the feature simultaneously, they both commit locally. The second user to `git push` will be rejected by the remote git server (either non-fast-forward or merge conflict on `claim.json`). Aigon will catch the push failure, pull, see the existing claim, and inform the user that the feature was just claimed. This uses the git server as a reliable, zero-dependency mutex.
*   **Release:** The claim is implicitly maintained while the feature is in `03-in-progress` or `04-review`. When `aigon feature-close` runs, the directory moves to `05-done`, which acts as the resolution. Alternatively, an explicit `aigon feature-unclaim` can revert the claim commit.

### 3. Git Merge Behavior and Noise
*   **Commit Noise:** Automating state commits on every tiny transition would clutter the git history. We should only commit state changes on significant lifecycle boundaries: `feature-start`, `agent-status submitted`, and `feature-close`.
*   **Main vs. Feature Branch:** State changes must happen on the `main` branch to ensure global visibility. If they were on the feature branch, other developers' dashboards wouldn't see the updates without pulling all remote branches. This means Aigon needs to perform a quick checkout of `main`, apply the state update, commit, push, and return to the feature branch.
*   **Conflicts:** Moving different directories (e.g., Alice moves feature 10, Bob moves feature 11) will not cause git merge conflicts. Event log appending might cause conflicts if two people bypass the claim system, but appending to `.jsonl` is a simple merge resolution.

### 4. Git Host Independence
The above pure-git claiming mechanism is 100% host-independent. It works identically on GitHub, GitLab, Bitbucket, or a bare SSH git remote because it only relies on git's internal push rejection logic.

### 5. Multi-User UX and Dashboard
*   Users are identified by their git config (`user.email`).
*   The dashboard reads `claim.json` and displays the user's initials or a Gravatar on the feature card.
*   To see others' changes, the dashboard needs a "Sync" mechanism. `aigon board` could perform a background `git fetch` to show an "Updates Available" indicator, prompting the user to `git pull`.

### 6. Migration and Pro Positioning
*   **Migration:** A one-time `aigon migrate-team` command is needed to convert existing flat specs into directory structures and move the gitignored workflow state into these directories.
*   **Pro Positioning:** The underlying data restructuring (directory-per-feature) can be OSS, but the pure-git syncing engine, team dashboard views, and Slack notifications should be positioned as Pro features.

## Sources
*   Git Push documentation (for mutual exclusion based on non-fast-forward rejection)
*   Aigon codebase (`lib/workflow-core/paths.js`, `lib/worktree.js`)
*   Event sourcing architectures (for conflict resolution on `.jsonl` files)

## Recommendation

Implement a **Directory-Per-Feature** model with **Pure-Git Claiming**. 

1. Refactor the spec storage so that `docs/specs/features/0N-*/feature-{id}-name` is a directory instead of a file. The spec lives inside as `spec.md`, and workflow state lives alongside it in a `state/` subdirectory.
2. Update `lib/workflow-core/paths.js` to resolve state from these co-located directories rather than the centralized `.aigon/workflows/` folder.
3. Keep highly ephemeral files (`heartbeat`, locks) gitignored in `.aigon/state/`.
4. Implement a `state/claim.json` mechanism managed by `feature-start` that commits and pushes to `main` to enforce mutual exclusion using the git server's push rejection logic.
5. Create a background sync/fetch mechanism for the Dashboard to detect when the board state has changed upstream.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| team-mode-config | Add a `teamMode` boolean to `config.json` to toggle committed state behavior | high | none |
| directory-per-feature | Refactor spec resolving and creation to use a directory model containing `spec.md` | high | team-mode-config |
| co-located-workflow-state | Update `workflow-core` paths to read/write state from the feature directory | high | directory-per-feature |
| pure-git-claiming | Add `claim.json` creation, commit, and push logic to `feature-start` for mutual exclusion | high | co-located-workflow-state |
| team-dashboard-avatars | Read claims and display user initials/avatars on the board and dashboard | medium | pure-git-claiming |
| background-git-sync | Add a background `git fetch` to the dashboard/board to detect upstream state changes | medium | none |
| migrate-team-command | Create a CLI command to migrate solo repos to the multi-user directory structure | medium | co-located-workflow-state |
| main-branch-state-updates | Update agent lifecycle commands to commit state changes directly to the `main` branch | high | co-located-workflow-state |
