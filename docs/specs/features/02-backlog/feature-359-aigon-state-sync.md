---
complexity: high
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-25T10:25:58.606Z", actor: "cli/feature-prioritise" }
---

# Feature: aigon-state-sync

## Summary

Add a first-class `aigon sync` command that lets a user reliably move their Aigon workstation between machines. Today, full-state push/pull exists but has no merge awareness — switching machines requires a hard stop on Machine A before starting on Machine B. This feature introduces a lightweight sync protocol built on top of the existing flat-file state (which is already git-friendly) so that users can `aigon sync push` / `aigon sync pull` and safely continue work on a new machine. The initial target is a single-user two-machine scenario; the design must not foreclose future team/multi-user use.

## User Stories

- [ ] As a solo user on Machine A, I can run `aigon sync push` and have all current Aigon state (specs, workflow snapshots, events) committed and pushed to a configured remote so Machine B can pick it up.
- [ ] On Machine B, I run `aigon sync pull` and my dashboard immediately shows the same board state as Machine A — including all backlog features, research topics, and completed work.
- [ ] Features that were in-progress on Machine A (active worktrees, live tmux sessions) are marked as "suspended" on Machine B rather than appearing runnable, so I don't accidentally start a session that doesn't have the worktree locally.
- [ ] I can configure the sync remote once (`aigon sync configure <remote>`) and subsequent push/pull use it without further prompts.
- [ ] (Future / out of scope now) A team member can pull my pushed state and see the same board, then push their own additions; deltas merge cleanly.

## Acceptance Criteria

- [ ] `aigon sync configure <git-remote-url>` stores the remote in `.aigon/config.json` as `sync.remote`.
- [ ] `aigon sync push` commits all changes under `.aigon/` (excluding `locks/`, `sessions/index.json`, and any `.env*` files) with message `aigon-sync: <timestamp>` and pushes to `sync.remote` on a dedicated `aigon-state` branch.
- [ ] `aigon sync pull` fetches and fast-forward merges `aigon-state` from the remote; reports conflicts if the branch has diverged (detected via `git merge-base --is-ancestor`) and instructs the user to resolve manually.
- [ ] After a pull, features whose `worktreePath` no longer exists locally are shown with a `[suspended]` badge in the `STATUS` column of `aigon board` output; `aigon feature-start` on a suspended feature re-creates the worktree from scratch rather than erroring.
- [ ] `aigon sync status` shows: last push timestamp, last pull timestamp, number of local-only commits, number of remote-only commits.
- [ ] `.aigon/.syncignore` (similar to `.gitignore`) lists paths excluded from sync; defaults include `locks/`, `sessions/`, `*.env`.

## Validation

- [ ] **Integration Test:** Script that initializes two empty directories as Aigon workspaces, configures a shared bare git repo as the sync remote, and verifies that `aigon sync push` from Workspace A followed by `aigon sync pull` in Workspace B replicates all features and research topics.
- [ ] **Conflict Test:** Verify that if both workspaces have local-only `.aigon` changes, `aigon sync pull` refuses to merge and provides the correct manual resolution command.
- [ ] **Suspension Test:** Verify that `aigon board` on Workspace B shows `[suspended]` for a feature started on Workspace A, and that `aigon feature-start` on that feature successfully re-clones/re-links the worktree.

## Pre-authorised

- May add `sync` key to `.aigon/config.json` schema.
- May skip `npm run test:ui` if this feature touches only `lib/` and CLI commands, no dashboard assets.

## Technical Approach

**Why git as the transport:** The `.aigon/` state directory is already flat JSON + JSONL, which git merges well. JSONL event logs are append-only and thus naturally conflict-free. Workflow snapshot JSON files are last-write-wins per entity (keyed by entity ID), so conflicts are rare and recoverable. Using git avoids introducing any new sync infrastructure — users already have git installed.

**Branch strategy:** A dedicated `aigon-state` branch lives in the configured remote. To avoid disrupting the user's current worktree/branch, `aigon sync` operations should use a temporary git index or a background worktree to manage the `aigon-state` branch commits.
- **Initialization:** If `aigon-state` doesn't exist on the remote, it is initialized as an orphan branch.
- **Commit Format:** `aigon-sync: <ISO-8601-timestamp>`.

**Excluded from sync:**
- `locks/` — machine-local coordination primitives
- `sessions/index.json` — machine-local tmux session index (from F351)
- `*.env`, `.env.local` — secrets
- Worktree paths themselves — only metadata syncs, not worktree file contents. These should be enforced via a generated `.aigon/.syncignore` that is automatically used during the internal commit process.

**Suspended feature detection:** On pull, scan `workflows/features/*/snapshot.json` for entries with `worktreePath` set. If that path doesn't exist on the current machine, show `[suspended]` in the `STATUS` column of `aigon board` (e.g., `[suspended] in-progress`). This is a read-path decoration — nothing is written to the snapshot, so the remote state stays clean.

**Conflict handling (MVP):** On diverged branches, refuse to auto-merge and print a clear message with `git pull --rebase` instructions. True CRDT/merge is out of scope.

**Future team extension:** The same push/pull model works for teams with a shared remote. Per-entity JSONL event logs accumulate contributions from multiple machines. A future `aigon sync merge` command could do event-log union rather than last-write-wins.

## Dependencies

- F351 (tmux-session-entity-binding) — suspended feature detection uses the `sessions` array in snapshot.json introduced by F351 to distinguish "had a live session on another machine" from "never started".

## Out of Scope

- Real-time sync / watch mode
- CRDT merge of conflicting snapshot edits
- Team access control or authentication
- Syncing worktree file contents (only metadata syncs)
- A hosted AigonSync cloud service

## Open Questions

- Should the `aigon-state` branch live in the same remote as the project repo, or should users configure a separate bare repo? Separate is cleaner for teams; same remote is simpler for solo. Recommendation: support both; default to same remote.
- Should `aigon sync push` auto-commit, or require a clean `.aigon/` diff first? Auto-commit is more user-friendly for solo use.

## Related

- Research: none
- Set: none
- Prior: F351 (tmux-session-entity-binding)
