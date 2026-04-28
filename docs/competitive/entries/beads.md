# Beads (`bd`)

- **Slug:** `beads`
- **Tier:** B-adjacent — *agent memory / issue layer*, not an orchestrator (different shape)
- **Repo:** [`steveyegge/beads`](https://github.com/steveyegge/beads) (~22.4k stars)
- **Author:** Steve Yegge (released October 2025)
- **License:** MIT
- **Last verified:** 2026-04-28

## What it is
A git-backed, dependency-aware, graph-oriented issue tracker designed as **external memory for coding agents**, not as an orchestrator. Solves what Yegge calls the "50 First Dates" problem — agents losing context between sessions and creating conflicting markdown swamps. Tasks are typed nodes (`bd-a3f2`, hash-based IDs) with priority, status, and typed dependency edges (`relates_to`, `duplicates`, `supersedes`, `replies_to`). State lives in `.beads/embeddeddolt/` (embedded Dolt SQL — version-controlled with cell-level merge and branching) and JSONL exports committed to git. Drop a one-liner into `CLAUDE.md` / `AGENTS.md` and the host agent starts reading and writing tasks against it.

## Matrix cells (public 5)
- **Unit of work:** Issue / task node (typed graph entry)
- **Source of truth:** `.beads/` Dolt + JSONL in git (or non-git via `BEADS_DIR`)
- **Multi-agent posture:** Agent-agnostic memory layer (n/a — not an orchestrator)
- **Model flexibility:** Agent-agnostic; integrates with Claude Code, Copilot, etc. via instructions
- **Pricing:** Free OSS + BYO

## Matrix cells (internal 5)
- **Orchestration substrate:** n/a — sits beside whatever runtime is driving
- **Isolation:** n/a (embedded mode = single-writer file lock; server mode = multi-writer)
- **Evaluation:** n/a — provides "memory decay" compaction of closed tasks; not a code reviewer
- **Autonomy:** n/a — orthogonal to autonomy axis
- **Interface:** `bd` CLI + agent-readable instructions in `CLAUDE.md` / `AGENTS.md`

## Closest to Aigon on
The "give the agent durable, git-versioned external state" intuition. Aigon answers it with Markdown specs + workflow snapshots; Beads answers it with a graph database. Both reject chat-history-as-state.

## Where it beats Aigon
- **Conflict-free concurrent writes:** Dolt's cell-level merge handles two agents touching the same task's status/priority simultaneously without rebase pain. Aigon's spec-as-Markdown approach gets harder when many agents touch one spec.
- **First-class dependency graph:** typed edges (`blocks`, `duplicates`, `supersedes`) with auto-ready detection. Aigon's dependency model is feature-level only, no graph queries.
- **Memory decay:** automatic semantic summarisation of old closed tasks to save context budget — Aigon has nothing equivalent yet.
- **Plug-and-play:** install once, add a line to `CLAUDE.md`, done. No tmux, no dashboard, no Kanban.

## Where Aigon wins
- **Aigon is a different category.** Beads is *memory infrastructure* an agent reads from; Aigon is an *orchestration harness* that drives multiple agents in worktrees, runs evaluation, and tracks lifecycle. Beads doesn't spawn or compare agents; Aigon does.
- Specs > tickets for design reasoning: a Markdown spec carries narrative and acceptance criteria; a graph node carries metadata.
- Aigon's Fleet/eval/Autopilot loop has no Beads analogue — Beads tells *one* agent what to do next, it doesn't pick winners across agents.

## Strategic note
Beads and Aigon are **complementary, not substitutes**. A future integration is plausible: Aigon could write feature lifecycle events (`feature.created`, `feature.merged`) as Beads issues so a coding agent inside a worktree has graph-native context for "what else is in flight." Worth a separate research topic (`arc`) — flagged.

## Sources
- [github.com/steveyegge/beads](https://github.com/steveyegge/beads) — README, Dolt storage, agent integration
- [Steve Yegge — Introducing Beads (Medium)](https://steve-yegge.medium.com/introducing-beads-a-coding-agent-memory-system-637d7d92514a) — author rationale
- [DeepWiki — steveyegge/beads](https://deepwiki.com/steveyegge/beads) — architecture deep-dive
- [bruton.ai — Beads (bd) the missing upgrade for AI coding agents in 2026](https://bruton.ai/blog/ai-trends/beads-bd-missing-upgrade-your-ai-coding-agent-needs-2026)
