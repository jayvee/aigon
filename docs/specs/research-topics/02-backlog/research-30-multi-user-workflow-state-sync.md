# Research: Multi-User Workflow State Sync

**Created:** 2026-04-12

## Context

Aigon currently assumes a single developer per repo. All workflow engine state (`.aigon/workflows/`, `.aigon/state/`) is gitignored and local to one machine. This works for solo use but breaks the moment two people want to use Aigon on the same repository — neither person can see the other's feature lifecycle state, board positions, or agent progress.

The goal is to understand what it would take for two (or more) developers to use Aigon on the same repo, where:
- Each person works on **distinct features** (no concurrent work on the same feature)
- They can **see each other's board state** — what's in progress, what's done, who's working on what
- **Git and GitHub are the sync mechanism** — state is committed and pushed, not stored in a separate service
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

### Multi-user UX
- [ ] How do users assign themselves to features? Is there an "owner" field on the spec or engine state?
- [ ] How does the dashboard show who is working on what?
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
- Multi-user feature assignment model
- Migration path from current architecture
- Dashboard changes for multi-user visibility
- Interaction with PR workflow (research-pr-option)
- Pro/OSS boundary

### Out of Scope
- Concurrent work on the same feature by multiple users (explicitly excluded)
- Real-time collaboration (this is async via git, not live)
- External state storage (databases, cloud services) — git is the sync layer
- Multi-repo coordination
- Agent-to-agent communication across machines

## Findings
<!-- To be completed during research -->

## Recommendation
<!-- To be completed during research -->

## Output
<!-- To be completed during research -->
- [ ] Feature:
