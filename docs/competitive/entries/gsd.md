# GSD — Get Shit Done

- **Slug:** `gsd`
- **Tier:** A — direct competitor (closest "spec-driven orchestrator" peer by mindshare)
- **Repo:** [`gsd-build/get-shit-done`](https://github.com/gsd-build/get-shit-done) (~58.3k stars)
- **Author:** TÂCHES (developer handle)
- **License:** MIT
- **Last verified:** 2026-04-28

## What it is
Discuss → Plan → Execute → Verify methodology, originally Claude-Code-only and now supporting 14 runtimes (Claude Code, OpenCode, Gemini CLI, Kilo, Codex, Copilot, Cursor, Windsurf, Antigravity, Augment, Trae, Qwen Code, CodeBuddy, Cline). Wave-based execution with auto-dependency ordering, fresh sub-agent context per task, configurable git worktree isolation (`git.use_worktrees`, default true). Verification via `/gsd-verify-work` (UAT) and `/gsd-secure-phase` (threat-model-anchored). "Meta-prompting, context engineering and spec-driven development."

## Matrix cells (public 5)
- **Unit of work:** Markdown plan (`.planning/` directory)
- **Source of truth:** `.planning/` Markdown in git
- **Multi-agent posture:** sequential waves (sub-agents) within one runtime
- **Model flexibility:** 14+ runtimes (one at a time)
- **Pricing:** free OSS + BYO

## Closest to Aigon on
Spec-driven discipline, git-committed state, multi-runtime BYO. The "if I had to pick one peer" tool.

## Where it beats Aigon
- 14 runtime support out of the box vs Aigon's ~6.
- Larger community (58.3k stars).
- Wave-based auto-dependency ordering — spec defines waves, GSD figures out the order.
- Lighter-weight: spiking and sketching built in for early-stage work.
- Built-in security verification phase (`/gsd-secure-phase`) — Aigon has no security gate of its own.

## Where Aigon wins
- Full Kanban lifecycle (inbox → backlog → in-progress → review → done) vs GSD's single-milestone-at-a-time.
- Parallel multi-vendor agent competition (Fleet) — GSD runs one runtime at a time.
- Cross-agent evaluation as the merge gate, not in-runtime verifier sub-agents.
- Dashboard surface in addition to CLI.

## Sources
- [github.com/gsd-build/get-shit-done](https://github.com/gsd-build/get-shit-done)
- [SDD: GSD vs Spec Kit vs OpenSpec — Medium](https://medium.com/@richardhightower/agentic-coding-gsd-vs-spec-kit-vs-openspec-vs-taskmaster-ai-where-sdd-tools-diverge-0414dcb97e46)
