# Matrix — 10 axes × tracked tools

The full grid. The public page in `site/content/comparisons.mdx` is the **5-axis projection** of this file (axes 1–5 below).

**Last refreshed:** 2026-04-28 (added Superpowers, OpenSpec, Beads; refreshed GSD).
**Source citations:** see `entries/<slug>.md` per tool. Cell values that are observable from public docs at time of writing.

---

## The 10 axes

The axes below were chosen by surveying how Cline, Cursor, Devin, Aider, Spec Kit, and Augment structure their own comparison pages. Axes 1–5 are observable from any reader's quick scan of competitor docs ("public 5"); axes 6–10 need more context to read ("internal 5").

### Public 5 (most legible)

1. **Unit of work** — what's the atomic deliverable? (spec / task card / prompt session / issue)
2. **Source of truth** — where does state live? (Markdown specs in git / hosted board / cloud workspace / chat history)
3. **Multi-agent posture** — how does the tool combine agents? (parallel competition / sequential dependency chain / sequential delegation / single-agent)
4. **Model flexibility** — how do you choose models? (BYO subscriptions / curated set / vendor-locked)
5. **Pricing model** — how do you pay? (BYO subscriptions / platform fee / pay-per-ACU / free OSS)

### Internal 5 (need context to read)

6. **Orchestration substrate** — where does the work physically run? (CLI-in-tmux + worktrees / cloud sandbox / IDE-embedded / API-direct)
7. **Isolation model** — how are parallel efforts kept separate? (per-feature git worktrees / branches / cloud containers / in-place)
8. **Evaluation model** — how is work checked before merge? (cross-agent diff review / human review / rubric / none)
9. **Autonomy level** — who's in the driver's seat? (interactive pair / supervised agent / autonomous)
10. **Interface surface** — where do you interact? (CLI + dashboard / TUI / IDE-embedded / web app)

---

## Public 5 — observable cell values

Order: closest to furthest from Aigon. Aigon row first.

| Tool | Unit of work | Source of truth | Multi-agent posture | Model flexibility | Pricing |
|---|---|---|---|---|---|
| **Aigon** | Feature spec (Markdown) | Markdown specs in git | Parallel competition + sequential, with cross-agent eval | BYO Claude / Gemini / Codex / Cursor / OpenCode | Free OSS + BYO |
| **Cline Kanban** | Task card | Hosted board state | Sequential dependency chains | BYO Claude Code / Codex / Cline | Free OSS + BYO |
| **Superpowers** | Skill-orchestrated plan | Markdown plans in git | Parallel sub-agents + sequential pipeline (single host runtime) | 6+ runtimes (Claude Code / Codex / Cursor / OpenCode / Copilot / Gemini) | Free OSS + BYO |
| **Google Scion** | Task graph node | Hosted graph (or local) | Parallel + sequential, declarative graph | BYO Claude Code / Gemini / OpenCode / Codex | Free OSS + BYO |
| **GSD (Get Shit Done)** | Markdown plan | `.planning/` markdown in git | Sequential waves (sub-agents) within one runtime | 14 runtimes (one at a time) | Free OSS + BYO |
| **OpenSpec** | Delta spec proposal | `openspec/` markdown in git (propose → apply → archive) | Single-agent (delegates to one of 20+) | 20+ host agents (one at a time) | Free OSS + BYO |
| **GitHub Spec Kit** | Spec | Markdown specs in git | Single-agent (delegates to one of 30+) | Any of 30+ agents (one at a time) | Free OSS + BYO |
| **Beads (`bd`)** | Issue / graph node | `.beads/` Dolt + JSONL in git | Agent-agnostic memory layer (n/a — not an orchestrator) | Agent-agnostic | Free OSS + BYO |
| **Cursor 3 Agents Window** | Prompt | Chat history (per agent) | Up to 8 parallel agents | Curated (Cursor Composer + frontier) | $20/mo + overages |
| **Claude Code (alone)** | Prompt session | Chat history | Single-agent w/ sub-agents | Anthropic-locked | Anthropic subscription |
| **Aider** | Chat message | Git commit history | Single-agent | BYO any LLM | Free OSS + BYO |
| **OpenCode (anomalyco)** | TUI session | Chat history | Single-agent | 75+ providers incl. local Ollama | $10/mo Go, PAYG Zen, BYO |
| **Crush (charmbracelet)** | TUI session | `crush.json` + chat | Single-agent | Multi-provider via LSP / MCP | Free OSS + BYO |
| **Goose** | Recipe / session | Recipe YAML or chat | Sub-agent spawn | 15+ providers | Free OSS + BYO |
| **Devin 2.0** | Issue | Hosted workspace | Multiple cloud "Devins" in parallel | Cognition-locked | $20/mo + $2.25/ACU |
| **Jules** | Issue | Hosted workspace | Single-agent (async) | Gemini-locked | Google AI tiers |

---

## Internal 5 — orchestration / evaluation / autonomy / interface

| Tool | Orchestration substrate | Isolation | Evaluation | Autonomy | Interface |
|---|---|---|---|---|---|
| **Aigon** | Local CLI in tmux + git worktrees | Per-feature git worktree | Cross-agent diff review (Fleet) + structured rubric (Arena) | Interactive (Drive) → supervised (Fleet) → autonomous (Autopilot) | CLI + web dashboard + slash commands |
| **Cline Kanban** | Local CLI + ephemeral worktrees | Ephemeral worktree per card | GUI PR-style review on each card | Supervised | CLI + Kanban GUI + IDE sidecar |
| **Superpowers** | Host runtime + git worktrees | Git worktree per task / branch | Two-stage code review skill (spec compliance → code quality) + RED-GREEN-REFACTOR | Supervised | Slash commands within host runtime |
| **Google Scion** | Local / VM / Kubernetes containers | Container per agent + worktree | None built-in | Supervised | CLI + hub UI |
| **GSD (Get Shit Done)** | Local CLI inside any of 14 runtimes | Git worktrees (configurable, default on) | Plan-checker + `/gsd-verify-work` UAT + `/gsd-secure-phase` security gate | Supervised | CLI (host agent's UI) |
| **OpenSpec** | Local CLI bootstrapping any agent | Repo / branch | `/opsx:verify` alignment checkpoint | Supervised | CLI + slash commands |
| **GitHub Spec Kit** | Local CLI bootstrapping any agent | Repo / branch | None built-in (delegates to host agent) | Supervised | CLI + slash commands |
| **Beads (`bd`)** | n/a — sits beside any runtime | n/a (embedded = single-writer; server = multi-writer) | n/a — provides memory decay, not code review | n/a (orthogonal) | `bd` CLI + `CLAUDE.md` / `AGENTS.md` integration |
| **Cursor 3 Agents Window** | IDE-embedded + cloud VMs | Worktree or cloud machine per agent | Aggregated diff view | Supervised | IDE (tiled panes) |
| **Claude Code (alone)** | Local CLI | In-place | None built-in | Interactive / supervised | CLI |
| **Aider** | Local CLI | In-place | None (auto-commits per change) | Interactive pair | CLI |
| **OpenCode (anomalyco)** | Local TUI | In-place | None built-in | Interactive | TUI + IDE extension |
| **Crush (charmbracelet)** | Local TUI | In-place | None built-in | Interactive | TUI |
| **Goose** | Local CLI | In-place | None built-in | Supervised | CLI + GUI |
| **Devin 2.0** | Cloud sandbox | Cloud sandbox per Devin | PR review + visual QA | Autonomous | Web app + API |
| **Jules** | Cloud sandbox | Cloud sandbox | None built-in | Autonomous (async) | Web app |

---

## Aigon's choice on each axis — and what it costs

This is the section the public page projects honestly. Each axis is "Aigon picks X *because* Y, *which costs* Z" — never a unilateral win.

| Axis | Aigon's choice | Why | What it costs |
|---|---|---|---|
| Unit of work | Markdown spec | Reasoning against artifact ≫ chat history; survives context resets | Upfront friction; hostile to vibe-coding |
| Source of truth | Markdown specs in git | Diffs, blames, PRs, review tools all just work | No rich linking, no semantic search |
| Orchestration substrate | Local CLI in tmux + worktrees | Reuses your existing CLI subscriptions; debuggable with `tmux attach`; no cloud egress | Setup friction (tmux, terminal app) vs cloud "open URL and go" |
| Isolation | Per-feature git worktree | True parallel branches; physical file isolation; conflicts surface only at merge | More disk; more directories to mentally track |
| Multi-agent posture | Parallel competition + cross-agent eval (Fleet) OR solo | Best implementation wins; reviewers diverse | $$N× cost on Fleet; only worth it for high-stakes |
| Model flexibility | BYO subscriptions to Claude / Gemini / Codex | Use the tier you already pay for; no markup | Setup per-CLI; no curated default |
| Evaluation model | Cross-agent diff review | Different models catch different issues (R21 finding) | Slower than no-review; needs eval-capable agent |
| Autonomy | Supervised + Autopilot mode | User decides per feature; not a one-knob product | More cognitive overhead than "set it and forget it" Devin |
| Interface | Dashboard + CLI + slash | Same workflow at all three control levels | Three things to keep in sync |
| Pricing | Free OSS + BYO | No markup, no lock-in | No cloud convenience; users handle keys |

---

## Notes on cells

- **GSD's "Sequential waves"** — wave-based execution with auto-dependency ordering, but all within one runtime at a time. Not parallel-multi-agent in Aigon's sense.
- **Superpowers' "Parallel sub-agents"** — fresh sub-agents per task, dispatched concurrently, but all within the same host runtime (e.g. multiple Claude Code instances). Not multi-vendor competition like Aigon Fleet. Closest *shape* match to Aigon overall.
- **Cursor 3's "8 parallel agents"** — parallel inside the IDE shell; single vendor (Cursor) on the model side.
- **Devin's "Multiple cloud Devins"** — all the same agent, replicated. Not multi-vendor competition.
- **Cline Kanban's "GUI PR-style review"** — first-class diff review on cards, with comments agents read. Aigon's review flow is CLI/dashboard split; the GUI is read-only — see `weaknesses.md`.
- **OpenSpec vs Spec Kit** — both are spec-driven workflow tools (Tier B). OpenSpec is brownfield-native with delta semantics (ADDED / MODIFIED / REMOVED); Spec Kit targets greenfield. Listed as separate rows.
- **Beads is a different shape.** It's agent *memory* infrastructure, not an orchestrator — n/a values reflect that the axis doesn't apply, not that Beads is weak there. It's a complement to Aigon, not a substitute. See `entries/beads.md` "Strategic note".
- **OpenCode lineage** — only `anomalyco/opencode` is the row in this matrix. `sst/opencode` is superseded; see `landscape.md`.

For per-cell sourcing and last-verified dates, see `entries/<slug>.md`.
