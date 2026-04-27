# Cline Kanban

- **Slug:** `cline-kanban`
- **Tier:** A — direct competitor
- **Repo / package:** [`cline/kanban`](https://github.com/cline/kanban) · npm `cline`
- **License:** Apache-2.0
- **Last verified:** 2026-04-27 (R44)

## What it is
A Kanban board on top of CLI agents, with an ephemeral git worktree per task. CLI-agnostic (Claude Code + Codex + Cline). Real-time diff review on cards with comments the agents read. Free OSS, no account required.

## Matrix cells (public 5)
- **Unit of work:** task card
- **Source of truth:** hosted board state
- **Multi-agent posture:** sequential dependency chains
- **Model flexibility:** BYO Claude Code / Codex / Cline
- **Pricing:** free OSS + BYO

## Closest to Aigon on
Surface area — Kanban + worktree + CLI-agnostic + free OSS. The most direct competitor in the field.

## Where it beats Aigon
- Zero-friction onboarding (`npm i -g cline`).
- GUI PR-style review on each card with comments the agents read.
- Dependency chains by Cmd+click.

## Where Aigon wins
- Parallel competition (Fleet) — Cline's multi-task model is dependency chains, not racing the same task.
- Cross-agent evaluation as a first-class merge gate, not just per-card review.
- Markdown specs in git as the unit of work — survives Cline's hosted-state lifecycle.

## Sources
- [cline.bot/kanban](https://cline.bot/kanban)
- [github.com/cline/kanban](https://github.com/cline/kanban)
- [Announcing Cline Kanban](https://cline.bot/blog/announcing-kanban)
