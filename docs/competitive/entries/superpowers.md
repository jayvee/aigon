# Superpowers

- **Slug:** `superpowers`
- **Tier:** A — direct competitor (worktrees + parallel sub-agents + built-in code review)
- **Repo:** [`obra/superpowers`](https://github.com/obra/superpowers) (~171k stars)
- **Author:** Jesse Vincent (`obra`); accepted into the official Anthropic plugin marketplace 2026-01-15
- **License:** MIT
- **Last verified:** 2026-04-28

## What it is
A composable agentic-skills framework + opinionated SDLC methodology that installs into Claude Code (and 5+ other host runtimes) via the Claude plugin marketplace. Enforces a five-phase pipeline — **Clarify → Design → Plan → Code → Verify** — implemented as ~14 interlocking skills. Spawns fresh sub-agents per task ("subagent-driven-development") and supports "dispatching-parallel-agents" for concurrent execution. Includes a two-stage `requesting-code-review` skill (spec compliance, then code quality) and a RED-GREEN-REFACTOR cycle. Worktree-isolated by design.

## Matrix cells (public 5)
- **Unit of work:** Skill-orchestrated implementation plan (Markdown)
- **Source of truth:** Markdown plans + design docs in git
- **Multi-agent posture:** Parallel sub-agents + sequential pipeline (within one host runtime)
- **Model flexibility:** Claude Code, Codex CLI/App, Cursor, OpenCode, Copilot CLI, Gemini CLI (6+; one at a time)
- **Pricing:** Free OSS + BYO

## Matrix cells (internal 5)
- **Orchestration substrate:** Host runtime (e.g. Claude Code) + git worktrees
- **Isolation:** Git worktree per task / branch
- **Evaluation:** Two-stage code review skill (spec compliance → code quality) + RED-GREEN-REFACTOR
- **Autonomy:** Supervised
- **Interface:** Slash commands within host runtime

## Closest to Aigon on
Worktree isolation, multi-stage pipeline with explicit verify phase, built-in code review, parallel sub-agents, multi-runtime BYO. Of all tracked tools this is the closest *shape* match to Aigon's Drive-mode pipeline, just inside a single host-agent vendor at a time.

## Where it beats Aigon
- Distribution: 171k stars vs Aigon's much smaller footprint; in the official Anthropic marketplace.
- Skills primitive is composable — users can swap individual phases (Clarify, Design, Plan, Code, Verify) without rewriting the whole pipeline; Aigon's slash commands are less granular.
- Fresh-context sub-agents per task is built into the methodology, not an opt-in.
- Polished "onboarding senior-engineer process" framing — methodology is the product.

## Where Aigon wins
- **Cross-vendor parallel competition:** Superpowers' parallel sub-agents are all the same host runtime (e.g. multiple Claude instances). Aigon Fleet runs Claude + Gemini + Codex *competitively* on the same spec, picks the best diff. Reviewer diversity is the differentiator.
- **Cross-agent evaluation:** Aigon's eval step uses a *different* model than the implementer (R21 finding). Superpowers' code review runs in the same family as the coder.
- **Kanban lifecycle + dashboard:** Aigon has inbox → backlog → in-progress → review → done state with a web dashboard; Superpowers is host-CLI-only.
- **Autopilot mode:** Aigon supports unattended autonomous execution per feature; Superpowers is supervised throughout.

## Notes
Re-tier from initial assumption: when first scoped, Superpowers looked like Tier B (spec-driven workflow tool). After verifying it ships worktree isolation, parallel sub-agents, and two-stage code review — that's Tier A by `landscape.md` definition. The single-vendor-at-a-time constraint is the only thing keeping it from being a near-twin of Aigon's Fleet mode.

## Sources
- [github.com/obra/superpowers](https://github.com/obra/superpowers) — README, skills list, worktree integration
- [blog.fsck.com/2025/10/09/superpowers/](https://blog.fsck.com/2025/10/09/superpowers/) — Jesse Vincent's original methodology post
- [Superpowers, GSD, and gstack — Medium (Apr 2026)](https://medium.com/@tentenco/superpowers-gsd-and-gstack-what-each-claude-code-framework-actually-constrains-12a1560960ad) — comparative framing
- [Pasquale Pillitteri — Superpowers complete guide 2026](https://www.pasqualepillitteri.it/en/news/215/superpowers-claude-code-complete-guide)
