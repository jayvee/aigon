# Landscape — 4 tiers

The space has fractured since `research-21` (March 2026). Putting all tools on one matrix creates false equivalences. We tier them by *shape*, not by quality.

**Last refreshed:** 2026-04-28 (added Superpowers to Tier A; expanded OpenSpec in Tier B; added Beads as Tier E memory infrastructure).
**Next scan:** monthly via `recurring-competitive-refresh`.

---

## Tier A — Direct competitors (multi-agent CLI orchestrators in worktrees)

Aigon's actual peer group. The matrix and the public page foreground these.

- **Cline Kanban** (`cline/kanban`, npm `cline`, Apache-2.0) — closest surface-area match: Kanban board, ephemeral worktree per task, CLI-agnostic (Claude Code + Codex + Cline), task linking for dependency chains, real-time diff review on cards, free OSS, no account required.
- **Superpowers** (`obra/superpowers`, MIT, ~171k stars, in the official Anthropic plugin marketplace) — composable agentic-skills framework + Clarify → Design → Plan → Code → Verify methodology. Spawns fresh sub-agents per task and supports parallel sub-agent dispatch, all within one host runtime (Claude Code, Codex, Cursor, OpenCode, Copilot CLI, Gemini CLI). Built-in two-stage code review skill and worktree isolation. Closest *shape* match to Aigon's Drive-mode pipeline; the only thing it lacks is **cross-vendor** parallel competition.
- **Google Scion** (`GoogleCloudPlatform/scion`, open-sourced 2026-04-07) — "hypervisor for agents": isolated container + git worktree + credentials per agent; supports Claude Code, Gemini CLI, OpenCode, Codex; runs locally, on remote VMs, or Kubernetes. Local mode stable; hub mode ~80% verified.
- **GSD — Get Shit Done** (`gsd-build/get-shit-done`, ~57.6k stars) — Discuss → Plan → Execute → Verify; wave-based execution, 14+ runtimes including Claude Code / OpenCode. Single-milestone-at-a-time, no Kanban lifecycle, but the closest "spec-driven orchestrator" peer by mindshare.
- **Cursor 3 Agents Window** (April 2026) — up to 8 parallel agents in worktrees or remote machines; tiled pane UI; not CLI-agnostic but very close to Aigon's parallelism story inside the IDE.
- **oh-my-codex / oh-my-claudecode** — community templates wrapping Codex / Claude with worktrees + tmux + 30 role-specialised agents. `oh-my-codex` hit 18.8k stars April 2026.
- **Claude Squad / cmux / mux / Composio Agent Orchestrator / workmux** — long tail of similar tmux-and-worktree tools.

## Tier B — Spec-driven workflow tools (overlap on lifecycle, not on multi-agent)

- **GitHub Spec Kit** (`github/spec-kit`) — `/specify` `/plan` `/tasks` `/implement` slash commands, supports 30+ agents, Python CLI bootstrap, project "constitution" file. Closest to Aigon's slash-command + spec model; explicitly *not* an orchestrator.
- **OpenSpec** (`Fission-AI/OpenSpec`, MIT, ~43.6k stars) — lightweight delta-spec markdown workflow with a strict three-phase state machine: Propose (delta spec with ADDED / MODIFIED / REMOVED markers) → Apply → Archive. Brownfield-native, in contrast to Spec Kit's greenfield framing. 20+ host agents. Tool-agnostic, no orchestration.
- **BMAD-METHOD** — named-persona pipeline (Mary / Preston / Winston / Sally / Simon / Devon / Quinn) for full SDLC. Heavyweight; methodology more than tool.
- **Tessl** — spec-driven framework + Spec Registry (open beta), Series A 2026. Hosted-leaning.
- **Kiro** (AWS) — spec-driven IDE; review noted "over-specification" friction outside AWS.

## Tier C — Single-agent coding tools (engines or complements, not competitors)

These are the *engines* Aigon orchestrates, plus their close peers. Cite them as engines or complements, not as competitors.

- **Claude Code, Gemini CLI, Codex CLI** — engines Aigon orchestrates. Cite as such, never compare against.
- **Cursor (non-Agents-Window mode), Windsurf** (Cognition-owned), **GitHub Copilot CLI** — IDE-leaning engines; can also be orchestrated.
- **Aider** (Apache-2.0) — chat-first pair-programmer, ~70% of its own code AI-written, last release Feb 2026. Smallest cognitive overhead in the field.
- **OpenCode** (`anomalyco/opencode`, ex-SST) — TUI / CLI single agent, 75+ providers, Anomaly subscriptions ($10/mo Go, PAYG Zen, Black enterprise). The Go fork at `sst/opencode` is the older project and has been **superseded** (not strictly archived); the *anomalyco* fork is the active one.
- **Crush** (`charmbracelet/crush`, ~23.5k stars) — Go-based TUI by the Charm team, multi-provider, LSP + MCP. Independent codebase from `sst/opencode`; sometimes referred to as the spiritual Go-lineage successor in the TUI niche.
- **Goose** (Apache-2.0, now under Linux Foundation's AAIF) — multi-provider, 70+ extensions, can spawn parallel sub-agents.
- **AmpCode** (Sourcegraph) — VS Code + CLI, semantic code-graph context, parallel sub-agents, threads-as-first-class.

## Tier D — Autonomous cloud agents (different shape entirely)

- **Devin 2.0** (Cognition) — $20/mo + $2.25/ACU; cloud sandbox; 13.86% real-GitHub-issue resolution; 83% more tasks per ACU vs v1.
- **Jules** (Google) — out of public beta, Gemini 3 Pro; "Project Jitro" (KPI-driven) waitlisted, expected Google I/O 2026.
- **GitHub Copilot Coding Agent** — hosted, PR-first.

## Tier E — Agent memory / state infrastructure (complement, not competitor)

These tools sit *beside* a coding agent and give it durable, queryable state. They don't orchestrate, evaluate, or pick winners — they replace the "agent rereads chat history" anti-pattern with a structured store. Cite as complements; an Aigon ↔ Tier-E integration is usually plausible.

- **Beads** (`steveyegge/beads`, MIT, ~22.4k stars, released October 2025) — git-backed graph issue tracker, embedded Dolt SQL with cell-level merge for conflict-free concurrent writes. Typed dependency edges (`relates_to`, `duplicates`, `supersedes`), hash-based IDs (`bd-a3f2`), `auto-ready` detection, semantic memory decay on closed tasks. Drop a one-liner in `CLAUDE.md` / `AGENTS.md` and the host agent reads / writes against it. Solves "50 First Dates" — agents losing context between sessions.

---

## Drops since `research-21` (March 2026)

- **Roo Code** — Extension / Cloud / Router products shut down 2026-05-15. Drop entirely. Useful only as a cautionary "VC-funded harness shutdown" data point in `weaknesses.md`.
- **OpenCode-Go** (`sst/opencode`) — superseded by `anomalyco/opencode`; entry collapsed to a lineage note on the OpenCode row.
- **GitHub Copilot Workspace** — discontinued.
- **Mistral Vibe** — still scoring weakly; drop.

## Net new since `research-21`

- **Google Scion** (Apr 2026) — most strategically significant; full Tier A entry.
- **Cline Kanban** — closest direct competitor.
- **Superpowers** (added 2026-04-28) — closest *shape* match to Aigon's Drive-mode pipeline; 171k stars; only differentiator Aigon retains over it is cross-vendor parallel competition. Strategically important.
- **OpenSpec** (added 2026-04-28) — Tier B; brownfield-native delta semantics fill the gap Spec Kit doesn't address.
- **Beads** (added 2026-04-28) — Tier E; agent memory infrastructure, complement not competitor; integration candidate.
- **Cursor 3 Agents Window** (Apr 2026) — multi-agent inside the IDE.
- **oh-my-codex / oh-my-claudecode** — community orchestration templates.
- **Anthropic three-agent harness pattern** (planner / generator / evaluator) — pattern, not a tool, but reframes the evaluation axis on the matrix.

## Open lineage / disambiguation notes

- **OpenCode**: two distinct projects share the name historically. `sst/opencode` is the older Go fork (now superseded). `anomalyco/opencode` is the active TS fork — that's the row in `matrix.md`.
- **Crush**: independent project by Charm. Often described informally as a Go-lineage successor to the original `sst/opencode` TUI niche, but is not a fork — separate codebase, separate team. Listed as its own row.
- **GSD**: fully named *Get Shit Done* (`gsd-build/get-shit-done`), authored by developer **TÂCHES**. The `GSD` shorthand collides with several other tools — always use the full name in long copy. (Note: "GSD (Taches)" disambiguates by author handle, not by pointing to a separate tool.)
- **Superpowers**: created by Jesse Vincent (`obra`), *not* by Anthropic. The Anthropic plugin marketplace acceptance (2026-01-15) is distribution, not authorship. Multiple downstream forks exist (`pcvelz/superpowers` etc.) — `obra/superpowers` is canonical.
