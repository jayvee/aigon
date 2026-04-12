# Research: Multi-User Workflow State Sync

**Created:** 2026-04-12

## Context

Aigon currently assumes a single developer per repo. All workflow engine state (`.aigon/workflows/`, `.aigon/state/`) is gitignored and local to one machine. This works for solo use but breaks the moment two people want to use Aigon on the same repository — neither person can see the other's feature lifecycle state, board positions, or agent progress.

The goal is to understand what it would take for two (or more) developers to use Aigon on the same repo, where:
- Each person works on **distinct features** (no concurrent work on the same feature)
- They can **see each other's board state** — what's in progress, what's done, who's working on what
- **Git is the sync mechanism** — state is committed and pushed, not stored in a separate service. The design should work with any git remote (GitHub, GitLab, Bitbucket, bare repo) — no platform-specific API dependency for core functionality
- The workflow engine state for a feature **travels alongside its spec file** as a single unit

This is a reversal of the research-14 decision to gitignore `.aigon/state/` and `.aigon/workflows/`. That decision was correct for solo use (avoids noise commits, no merge conflicts with yourself). For multi-user, the trade-off flips: visibility and sync matter more than commit noise.

### Current state locations

| State | Location | Gitignored? | Notes |
|---|---|---|---|
| Feature specs | `docs/specs/features/0N-*/` | No | Committed, folder = lifecycle stage |
| Workflow engine events | `.aigon/workflows/features/{id}/events.jsonl` | Yes | Append-only event log |
| Workflow engine snapshots | `.aigon/workflows/features/{id}/snapshot.json` | Yes | Derived from events |
| Agent status files | `.aigon/state/feature-{id}-{agent}.json` | Yes | Per-agent metadata |
| Heartbeat files | `.aigon/state/heartbeat-{id}-{agent}` | Yes | Touch-based liveness |
| Review state | `.aigon/workflows/features/{id}/review-state.json` | Yes | Current + history |
| Stats/telemetry | `.aigon/workflows/features/{id}/stats.json` | Yes | Cost, tokens, timing |
| Locks | `.aigon/locks/` | Yes | Exclusive file locks |

### Assumption

The most natural approach is to co-locate a feature's workflow state with its spec — moving them together through the pipeline as one unit. This would mean the workflow state for feature 42 lives inside (or next to) `docs/specs/features/03-in-progress/feature-42-*/` rather than in a separate gitignored directory. When the spec moves to `05-done/`, the state moves with it.

## Questions to Answer

### Feasibility and design
- [ ] Which state files can be committed safely? Events and snapshots are deterministic. Agent status and heartbeats are ephemeral/machine-local. Where is the line?
- [ ] What is the right co-location structure? Options: (a) a `state/` subdirectory inside the spec folder, (b) sibling files next to the spec, (c) a committed `.aigon/workflows/` with per-feature subdirectories
- [ ] How do spec folder moves work when state files are co-located? Does `git mv` handle the directory atomically?
- [ ] What happens to locks? They're inherently machine-local. Can we skip committing them and handle contention differently?
- [ ] How does the event-sourced model behave when two people have divergent event logs? (Shouldn't happen if features are distinct, but what if someone accidentally pushes stale state?)

### Git and merge behaviour
- [ ] What merge conflicts arise when two people push board state changes simultaneously? (e.g., both move different features between lanes)
- [ ] How much commit noise does this add? Can we batch state commits or use a single "sync state" commit?
- [ ] Should state commits be automated (on every transition) or manual (explicit `aigon sync` command)?
- [ ] How does this interact with feature branches? State changes on `main` vs state changes on the feature branch?

### Workflow engine changes
- [ ] What changes in `lib/workflow-core/` to read/write state from a committed location instead of `.aigon/workflows/`?
- [ ] Does the snapshot adapter (`lib/workflow-snapshot-adapter.js`) need to change?
- [ ] How does `aigon doctor --bootstrap` work when state is already committed?
- [ ] What happens to `feature-reset` — does it need to create a revert commit for the state files?

### Feature claiming and lightweight locking
The system needs a way for a user to "claim" a feature (or research topic) so that another user doesn't accidentally start working on it. This should be **lightweight** — not a full ticket assignment system like Linear or Jira. The goal is a simple mutual-exclusion signal, not a permissions model.

- [ ] What is the simplest claim mechanism that uses only git? Options: (a) a `claimed-by` field in the spec frontmatter or co-located state file, committed and pushed, (b) a git-native signal like branch existence (`feature-42-*` branch on the remote = claimed), (c) a lightweight lock file committed alongside the spec
- [ ] How does a user claim a feature? Should `aigon feature-start` automatically write a claim with the git user identity (`user.name` / `user.email`)? Or is there an explicit `aigon feature-claim 42` command?
- [ ] How does a user see what's claimed and by whom? Dashboard badge? `aigon board` annotation? Just reading the spec/state file?
- [ ] What happens when someone tries to `feature-start` a feature that's already claimed by another user? Hard block with an error? Warning with an override flag? Something else?
- [ ] How does a user release a claim? Automatically on `feature-close`/`feature-reset`? Explicit `aigon feature-unclaim`? Or is it implicit — if you push state showing the feature is done, the claim dissolves?
- [ ] Can the claim mechanism work without any external service? It should ideally be pure git (commit + push) so it works with GitHub, GitLab, Bitbucket, or even a bare git remote. No platform-specific API calls for the core locking — the remote is just a git server.
- [ ] What are the race condition edges? Two users both `feature-start` the same feature before either has pushed. Git push will reject the second push (non-fast-forward on main or conflicting state file). Is that sufficient, or do we need something more explicit?
- [ ] Should claims be recorded in the workflow engine event log (`feature.claimed { user, timestamp }`) so there's an audit trail, or is a simple field in the spec/state enough?
- [ ] How does this interact with Fleet mode? In solo use, Fleet means multiple agents on one machine. In multi-user, could two users each run one agent on the same feature? (Probably out of scope — but the claim model should be clear about what it prevents.)

### Git host independence
The sync mechanism should not depend on GitHub-specific features (GitHub API, GitHub Actions, GitHub Issues). Research whether the design can be **pure git** at the transport layer, with optional platform-specific enhancements layered on top.

- [ ] Can all state sync work with just `git push` / `git pull` to any remote? (GitHub, GitLab, Bitbucket, self-hosted bare repo, even a shared filesystem remote)
- [ ] Where would platform-specific APIs add value on top of pure git? Examples: PR creation (GitHub/GitLab API), claim notifications (webhooks), conflict detection (branch protection rules)
- [ ] Should the platform layer be pluggable (like the Jira/Linear adapter pattern from research-22)? Or is it simpler to just use git and let users set up their own CI/webhooks?
- [ ] Does the claim/lock mechanism need any server-side enforcement (e.g., branch protection, CODEOWNERS), or is convention + git's own conflict detection enough for small teams?

### Multi-user UX
- [ ] How do users identify themselves to Aigon? Git config (`user.name` / `user.email`) is the obvious answer — is it sufficient?
- [ ] How does the dashboard show who is working on what? Avatar/initials on board cards? A "Team" view?
- [ ] What happens when someone pulls and gets new state for features they don't own? Does the dashboard just show it?
- [ ] Is there a `aigon sync` or `aigon pull` command needed, or is `git pull` sufficient?

### Migration
- [ ] How do you migrate an existing solo-user repo to committed state? One-time script?
- [ ] Can committed and gitignored state coexist during a transition period?
- [ ] Is this opt-in via config (e.g., `teamMode: true`) or always-on?

### Pro positioning
- [ ] Is this a clean Pro feature (multi-user = team = Pro tier)?
- [ ] What's the minimal OSS surface needed? (e.g., the state relocation might be OSS, but the team assignment/dashboard features are Pro)
- [ ] How does this relate to the PR workflow research (research-pr-option)? Teams that sync state via git likely also want PRs.

## Scope

### In Scope
- Workflow state storage relocation design (gitignored to committed)
- Co-location strategy for spec + state as a unit
- Git sync mechanics (commits, merges, conflicts)
- Lightweight feature claiming / mutual-exclusion mechanism
- Git host independence — design for any git remote, not just GitHub
- Optional platform-specific enhancements (APIs, webhooks) as a layer on top
- Multi-user feature assignment model and identity (`git config` user)
- Migration path from current architecture
- Dashboard changes for multi-user visibility
- Interaction with PR workflow (research-pr-option)
- Pro/OSS boundary

### Out of Scope
- Concurrent work on the same feature by multiple users (explicitly excluded)
- Real-time collaboration (this is async via git, not live)
- Full ticket management / assignment system (not building Linear/Jira — just lightweight claiming)
- External state storage (databases, cloud services) — git is the sync layer
- Platform-specific API as a hard requirement (optional enhancement only)
- Multi-repo coordination
- Agent-to-agent communication across machines

## Findings
<!-- To be completed during research -->

## Recommendation
<!-- To be completed during research -->

## Output
<!-- To be completed during research -->
- [ ] Feature:
