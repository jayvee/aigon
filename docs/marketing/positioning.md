# Aigon — Positioning

This is the **single source of truth** for every long-form description of Aigon.
Every other surface — README, AGENTS.md, `site/public/llms.txt`, GitHub repo description, the landing hero — copies a chunk from here verbatim.

If a chunk is wrong, fix it here first, then propagate. Do not edit the projections directly.

**Category claim (verbatim, do not paraphrase):** `spec-driven multi-agent harness`.

---

## Why this category claim

The market settled in Q1 2026 around three orthogonal terms — **harness** (everything around the model: scaffolding, context, tool dispatch, safety gates), **multi-agent** (coordinating multiple agents on the same goal), and **spec-driven development** (Markdown specs as first-class executable artifacts).

Aigon sits at the intersection of all three. Each word does work:

- **harness** — cuts cleanly against "IDE" (Cursor), "framework" (LangGraph), "platform" (Devin), and singular "agent" (Aider, OpenCode).
- **multi-agent** — distinguishes Aigon from spec-only wrappers (Spec Kit, OpenSpec) and from single-agent tools.
- **spec-driven** — distinguishes Aigon from chat-first orchestrators (Cline Kanban) and from session-first agents.

See `docs/competitive/` for the landscape and matrix this claim is grounded in.

---

## One-liner

> Aigon is a spec-driven multi-agent harness — orchestrate Claude Code, Gemini CLI, and Codex CLI from one Kanban board, one CLI, or one slash command.

## Hero subtitle (one-line tagline, social bio)

> One Kanban for many agents — on real branches, in real worktrees, against real specs.

## One-paragraph (~70 words, README opener / press blurb)

> Aigon is a spec-driven harness for orchestrating multiple AI coding agents on the same codebase. Each feature is a Markdown spec in git; each agent runs in its own git worktree under tmux; the lifecycle moves through inbox → backlog → in-progress → review → done on a local Kanban board. Aigon doesn't try to be a model — it orchestrates Claude Code, Gemini CLI, and Codex CLI as engines.

## One-page (~250 words, landing page / docs intro)

> Aigon turns one repository into a fleet of coordinated coding agents. The artifact at the centre of every workflow is a Markdown spec, committed to git, that names a feature and its acceptance criteria. From there, Aigon spawns one or more agents — Claude Code, Gemini CLI, Codex CLI, Cursor, OpenCode — each in its own git worktree under tmux, each working independently against the same spec.
>
> When the agents are done, you compare diffs and merge a winner. When you want one agent in the driver's seat, you run Solo. When you want three agents racing, you run Fleet. The same spec, the same lifecycle, the same Kanban board.
>
> Aigon doesn't replace your coding agent — it orchestrates the ones you already pay for. You bring your Claude Pro, your Gemini key, your Codex CLI session. Aigon brings the workflow: feature lifecycle, isolated worktrees, cross-agent evaluation, structured reviews, recurring background tasks, and a dashboard you actually want to leave open.
>
> What Aigon is not: it is not an IDE, it is not a hosted product, and it is not a single-agent assistant. If you want inline completions, use Cursor. If you want zero-setup cloud autonomy, use Devin. If you want a single chat to make edits, use Aider. If you want all of the above, *coordinated* — that's Aigon.

## Conference abstract (~60 words)

> Aigon is a local, open-source harness for multi-agent coding. Markdown specs are the unit of work; git worktrees are the isolation boundary; tmux is the substrate. Claude Code, Gemini CLI, and Codex CLI run in parallel on the same feature, with cross-agent diff review as the merge gate — a working answer to Anthropic's three-agent (planner / generator / evaluator) pattern, on your laptop.

---

## Reusable copy chunks

Each chunk is a self-contained string. Copy verbatim into the named surface — do not adapt.

### `hero` — landing page hero

> One Kanban for many agents — on real branches, in real worktrees, against real specs.

### Hero candidates — two-payoff wedge (pending selection, 2026-04-28)

These three are drafted from the two-payoff frame in `aigon-vs.md`. Each leads with both halves of the wedge (reviewer diversity + quota arbitrage). **John's preference: candidate A.** None has propagated to surfaces yet — pick one, then ship in a single PR that updates the `hero` chunk above and every surface in the surface map.

**A — favoured (three-sentence punch)**

> Race the agents you already pay for. Catch what one model misses. Stop hitting quota walls.

**B — extends the existing "One Kanban" hero**

> One Kanban for many agents — different vendors for diversity, pooled quotas for headroom.

**C — benefit-led, longest**

> Use every subscription you pay for. Get every vendor's perspective. Stop waiting on a single quota wall.

### `bio` — social bio, GitHub repo description

> Spec-driven multi-agent coding harness for Claude Code, Gemini CLI, and Codex CLI — one Kanban, many agents, real worktrees.

### `readme` — README opener (under the title)

> Aigon is a spec-driven multi-agent harness — orchestrate Claude Code, Gemini CLI, and Codex CLI from one Kanban board, one CLI, or one slash command.

### `conference` — conference abstract / talk submission

> Aigon is a local, open-source harness for multi-agent coding. Markdown specs are the unit of work; git worktrees are the isolation boundary; tmux is the substrate. Claude Code, Gemini CLI, and Codex CLI run in parallel on the same feature, with cross-agent diff review as the merge gate — a working answer to Anthropic's three-agent (planner / generator / evaluator) pattern, on your laptop.

### `llms` — `site/public/llms.txt` summary line

> Aigon: spec-driven multi-agent harness. Feature lifecycle, git-worktree isolation, slash-command orchestration of Claude Code / Gemini CLI / Codex CLI. Workflow state in `.aigon/workflows/`, specs in `docs/specs/`, dashboard at `aigon server start`.

### `agents` — `AGENTS.md` opener / scaffold blurb

> Aigon is a spec-driven multi-agent harness — feature lifecycle, git-worktree isolation, and slash-command orchestration of Claude Code, Gemini CLI, and Codex CLI.

### `elevator` — verbal elevator pitch

> You know how each AI coding tool works in isolation? Aigon runs them together on the same task — each in its own git worktree, each against the same spec — and you ship the best diff. Claude, Gemini, and Codex compete; you pick the winner.

---

## Surface map

| Chunk | Lives in |
|---|---|
| `hero` | `site/public/home.html` (hero section) |
| `bio` | GitHub repo description, social bios |
| `readme` | `README.md` (under title) |
| `conference` | Talk submissions, press kit |
| `llms` | `site/public/llms.txt` (summary line) |
| `agents` | `AGENTS.md` (opener) |
| `elevator` | (verbal — no file surface) |

Plus: the **one-liner** is mirrored into the project memory entry `project_standard_descriptor.md` and into `site/public/home.html` `<meta name="description">` and `<meta property="og:description">`.

---

## Drift policy

- Any change here ships in the same PR as the propagation to all listed surfaces.
- A surface that drifts from a chunk is a bug, not a variant. If a surface needs a different message, that surface needs a *new chunk* added here, not a divergent edit.
- The recurring competitive scan (`recurring-competitive-refresh`, separate feature) does **not** auto-edit this file. Positioning shifts only when category-shaping moves happen, and a human writes the change.
