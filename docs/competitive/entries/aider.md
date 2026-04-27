# Aider

- **Slug:** `aider`
- **Tier:** C — single-agent (engine / complement)
- **Repo:** [Aider-AI/aider](https://github.com/Aider-AI/aider)
- **License:** Apache-2.0
- **Last verified:** 2026-04-27 (R44)

## What it is
Chat-first pair programmer in the terminal. ~70% of its own code AI-written. Auto-commits per change. Aider Polyglot leaderboard for transparent model comparison. Last release Feb 2026.

## Matrix cells (public 5)
- **Unit of work:** chat message
- **Source of truth:** git commit history
- **Multi-agent posture:** single-agent
- **Model flexibility:** BYO any LLM (via litellm)
- **Pricing:** free OSS + BYO

## Where it beats Aigon
- Smallest cognitive overhead in the field — open a chat, edit files, commits.
- Deepest git integration (auto-commits per change).
- Broadest model support via litellm.
- Repo-map for large-codebase context.

## Where Aigon wins
- Multi-agent orchestration — Aider is single-agent pair-programming.
- Markdown specs in git as the unit of work, not chat messages.
- Kanban lifecycle and cross-agent evaluation.

## Complementary usage
Aider for exploratory prototyping; bring results into Aigon's spec lifecycle for structured evaluation.

## Sources
- [Aider releases](https://github.com/Aider-AI/aider/releases)
- [Aider LLM Leaderboards](https://aider.chat/docs/leaderboards/)
