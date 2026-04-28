# OpenSpec

- **Slug:** `openspec`
- **Tier:** B — spec-driven workflow tool (overlap on lifecycle, not on multi-agent)
- **Repo:** [`Fission-AI/OpenSpec`](https://github.com/Fission-AI/OpenSpec) (~43.6k stars)
- **License:** MIT
- **Last verified:** 2026-04-28

## What it is
A lightweight delta-spec markdown workflow with a strict three-phase state machine: **Propose** (create a delta spec with ADDED / MODIFIED / REMOVED markers against existing functionality), **Apply** (implement the change), **Archive** (merge the delta into the source-of-truth spec). Tool-agnostic — installed via `npm i -g @fission-ai/openspec`, then drives slash commands inside any of 20+ host agents. Targets brownfield iteration explicitly, in contrast to Spec Kit's greenfield framing.

## Matrix cells (public 5)
- **Unit of work:** Delta spec proposal (Markdown)
- **Source of truth:** `openspec/` Markdown in git (proposal → apply → archive)
- **Multi-agent posture:** Single-agent (delegates to one of 20+ hosts)
- **Model flexibility:** 20+ host agents (one at a time)
- **Pricing:** Free OSS + BYO

## Matrix cells (internal 5)
- **Orchestration substrate:** Local CLI bootstrapping any agent (host's runtime)
- **Isolation:** Repo / branch (no per-spec worktrees built in)
- **Evaluation:** `/opsx:verify` checkpoint; alignment-before-implementation review on the proposal
- **Autonomy:** Supervised
- **Interface:** CLI + slash commands

## Closest to Aigon on
Markdown-specs-in-git source of truth, lifecycle discipline (proposal → apply → archive parallels inbox → in-progress → done), multi-host BYO. Sits in the same conceptual neighbourhood as Spec Kit but with delta semantics for brownfield work.

## Where it beats Aigon
- Brownfield-native delta semantics (ADDED / MODIFIED / REMOVED) — Aigon specs are full-feature Markdown, no first-class delta vocabulary against existing surfaces.
- Lighter footprint: no tmux, no worktrees, no dashboard — just a CLI and a directory.
- Cleaner archive step: applied deltas merge into a single canonical spec, vs Aigon's per-feature spec history.

## Where Aigon wins
- No multi-agent orchestration: OpenSpec drives one host agent at a time; Aigon runs Fleet competition + cross-agent eval.
- No worktree isolation: parallel proposals share one working tree.
- No structured eval beyond `/opsx:verify`'s alignment check; Aigon has cross-agent diff review as a merge gate.
- No dashboard / Kanban surface; OpenSpec is CLI-only.

## Sources
- [github.com/Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec) — README, installation, multi-host support
- [openspec.dev](https://openspec.dev/) — official site
- [Spec Kit vs OpenSpec — intent-driven.dev](https://intent-driven.dev/knowledge/spec-kit-vs-openspec/) — brownfield vs greenfield framing
- [SDD: GSD vs Spec Kit vs OpenSpec — Medium](https://medium.com/@richardhightower/agentic-coding-gsd-vs-spec-kit-vs-openspec-vs-taskmaster-ai-where-sdd-tools-diverge-0414dcb97e46)
