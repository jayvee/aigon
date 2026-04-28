# Weaknesses — what each competitor does better, and what Aigon doesn't do

The honest counterpart to the matrix. Two sections:

1. **Per-competitor wins** — where each competitor genuinely beats Aigon.
2. **Aigon's own honest weaknesses** — gaps users will hit; some have follow-up features in the same set.

**Last refreshed:** 2026-04-28 (added Superpowers, OpenSpec, Beads).

---

## 1. Per-competitor wins

### Cline Kanban
Zero-friction onboarding (`npm i -g cline`), no account, GUI PR-style review on each card with comments agents read, dependency chains by Cmd+click.
**Who it matters for:** anyone who values a polished GUI review surface. Aigon's review flow is CLI / dashboard split; the dashboard is read-only.

### Cursor 3 Agents Window
Best inline completion (Composer model is sub-second), tightest IDE integration, tiled multi-agent panes, embedded browser testing.
**Who it matters for:** teams embedded in VS Code; visual / QA-heavy workflows. Aigon has no editor surface at all.

### Google Scion
Container-grade isolation (Docker / Kubernetes / Apple containers), declarative task graphs, Google backing.
**Who it matters for:** teams that need production-grade isolation, not "tmux + worktrees". Aigon's substrate is lighter and faster to debug, but has no production-grade isolation story.

### GSD (Get Shit Done)
58.3k stars, 14 runtime support out of the box, wave-based execution with auto-dependency ordering, context-rot prevention, spiking / sketching built in, security verification phase (`/gsd-secure-phase`).
**Who it matters for:** solo devs who want a lighter-weight spec system focused on a single milestone at a time, especially on non-standard agent runtimes. GSD is single-milestone-at-a-time and one runtime at a time — that's the wedge Aigon's Kanban + Fleet competes on.

### Superpowers
171k stars and Anthropic plugin marketplace placement, 14 composable skills implementing a Clarify → Design → Plan → Code → Verify methodology, fresh-context sub-agent per task by default, parallel sub-agent dispatch, two-stage built-in code review (spec compliance → code quality), git worktree isolation, RED-GREEN-REFACTOR cycle. Closest *shape* match to Aigon's Drive-mode pipeline.
**Who it matters for:** anyone happy to commit to one host runtime (most often Claude Code) but who wants the worktree + parallel + verify discipline. The differentiator Aigon retains is **cross-vendor** parallel competition with cross-agent eval — Superpowers' parallelism is intra-vendor. If a user doesn't value reviewer diversity, Superpowers is the lighter pick.

### OpenSpec
Brownfield-native delta-spec semantics (ADDED / MODIFIED / REMOVED) and a clean three-phase Propose → Apply → Archive lifecycle that merges deltas into a canonical spec. 20+ host agents.
**Who it matters for:** teams iterating on a stable codebase who want spec discipline without the weight of a full Kanban / orchestration system. Aigon has no first-class delta semantics; specs are full-feature Markdown.

### Beads (`bd`)
Git-backed graph-oriented issue tracker as external memory for coding agents. Conflict-free concurrent writes via Dolt's cell-level merge. First-class typed dependency edges with auto-ready detection. Semantic memory decay on closed tasks to save context budget. 22.4k stars.
**Who it matters for:** anyone whose pain is "the agent forgot what it was doing yesterday" rather than "I want multiple agents racing." Beads is *complementary* to Aigon — different shape. A future Aigon ↔ Beads integration is plausible (lifecycle events as Beads issues); flagged in `entries/beads.md`.

### GitHub Spec Kit
30+ agent support out of the box, project `constitution.md`, lightest spec wrapper.
**Who it matters for:** anyone who wants spec-driven discipline without orchestration. Aigon supports ~6 agents natively.

### Kiro
Spec-driven development with zero setup; EARS notation is more structured than freeform Markdown; AWS backing; free (includes Claude Sonnet).
**Who it matters for:** teams that want SDD without managing multiple agents; AWS shops; solo devs who want one tool.

### Devin 2.0 / Jules
Zero local setup, fully autonomous on cloud sandbox, browser tooling, integrations (Linear, Slack, Datadog).
**Who it matters for:** enterprise teams doing large migrations; teams that want zero local infrastructure; scheduled / automated workflows. Aigon requires terminal + agent CLIs.

### Aider
Smallest cognitive overhead — opens a chat, edits files, commits. Auto-commits per change. Aider Polyglot leaderboard for transparent model comparison.
**Who it matters for:** anyone who wants the simplest possible terminal AI tool; pair-programming style.

### OpenCode (anomalyco)
75+ provider support including local Ollama; mid-session model switch (`Ctrl+O`); 132k stars (lineage); large user base.
**Who it matters for:** anyone who wants maximum model flexibility and first-class local-model support. Aigon's per-feature model selection is heavier and lacks first-class local-model support — gap from R25 still open; tracked as `local-model-first-class-support`.

### Crush (charmbracelet)
Go-based (fast, low resource usage); LSP-enhanced context; Charm ecosystem integration; multi-platform including FreeBSD; AGENTS.md auto-initialisation.
**Who it matters for:** terminal-native developers; Go / Rust shops; Charm ecosystem users.

### Goose
70+ extensions and Linux Foundation governance.
**Who it matters for:** anyone who needs vendor-neutral governance. Aigon's extension story is `templates/` and skills only.

### AmpCode
Semantic code graph (Sourcegraph) for repo-aware retrieval; Oracle + Librarian specialised sub-agents; pay-as-you-go with no markup; built-in code review (Checks).
**Who it matters for:** developers working in large codebases who need semantic context. Aigon has no semantic context layer.

### Roo Code (until 2026-05-15)
Per-request cost surfaced inline, Cloud Analytics dashboard, fine-grained per-mode tool restrictions (`fileRegex`).
**Who it matters for:** anyone who needs cost visibility per agent. Aigon has telemetry but no cost dashboard — gap from R24 still open; tracked as `agent-cost-dashboard`.
**Cautionary note:** Roo Code's Extension / Cloud / Router products shut down 2026-05-15, despite VC funding. A useful data point for "harness tools can disappear" — argues for the BYO + git-committed-state posture Aigon takes.

### Where every competitor wins on community / maturity
Aigon's contributor count is small. Superpowers (171k stars), Cline Kanban (5M+ installs), Aider, Spec Kit, Goose, OpenCode (132k stars), GSD (58.3k stars), OpenSpec (43.6k stars), Beads (22.4k stars) all have a much wider extension ecosystem. This is a real gap that doesn't get a "fix" feature — it's just early.

---

## 2. Aigon's own honest weaknesses

These are the things Aigon does *not* do, listed plainly. The public page surfaces a subset; this list is the full version.

1. **No IDE experience.** CLI + web dashboard only. If your team lives in an IDE and rarely opens a terminal, Aigon is the wrong tool. Cursor, Cline, and Kiro all offer native IDE experiences.

2. **No zero-config onboarding.** Getting started requires installing the CLI, understanding the spec lifecycle, learning slash commands, and configuring agent hooks. One-click IDE tools like Cursor or Cline are productive in minutes.

3. **No embedded visual testing.** No browser testing, no visual diffs, no screenshot-based verification. Cursor's aggregated diff view and embedded browser are better for visual comparison.

4. **Requires multiple subscriptions to use Fleet.** The differentiator is multi-agent competition, which means multiple API keys or subscriptions for the full experience. Solo Drive mode mitigates this but doesn't deliver the parallel-competition value.

5. **Smaller community.** Aigon is new and small. Fewer tutorials, fewer Stack Overflow answers, less battle-testing.

6. **Spec maintenance overhead.** Specs can become stale if not actively maintained. The state machine enforces spec-driven flow but doesn't enforce spec freshness. Unlike Kiro's EARS notation, Aigon requires manual spec writing.

7. **No cloud execution.** All agents run locally in tmux. There's no cloud sandbox option like Cursor Background Agents or Devin. This limits scalability for teams without powerful local machines.

8. **No first-class local-model support.** OpenCode and Goose make local Ollama / OpenAI-compatible endpoints table-stakes. Aigon's agent config doesn't yet treat them as first-class. Tracked: `local-model-first-class-support`.

9. **No per-agent / per-feature cost dashboard.** Roo Code surfaced cost inline. Aigon has telemetry but no spend view — a parallel-agent user wants to see "this Fleet run cost $4.20" before deciding to do another. Tracked: `agent-cost-dashboard`.

10. **Read-only dashboard.** By design (no state mutation from the dashboard) but it costs convenience. Cline Kanban's GUI is read-write; reviewers can comment directly on cards.
