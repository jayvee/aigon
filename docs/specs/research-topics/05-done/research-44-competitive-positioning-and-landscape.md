---
complexity: very-high
transitions:
  - { from: "in-progress", to: "done", at: "2026-04-27T00:57:38.495Z", actor: "cli/research-close" }
  - { from: "inbox", to: "backlog", at: "2026-04-26T23:30:45.954Z", actor: "cli/research-prioritise" }
---

# Research: competitive-positioning-and-landscape

## Context

Aigon's current competitor story is fragmented and unconvincing. We have:

- A public comparison page (`site/content/comparisons.mdx`) that mixes marketing claims with binary-dot matrices.
- An "extended" internal version (`docs/comparisons-extended.md`) slated for deletion.
- Three completed research topics (research-21 landscape, research-24 Roo Code, research-25 OpenCode) whose findings haven't been consolidated.
- An inbox feature (F238) that proposes rewriting the public page with a concrete observable-row matrix and a 10-tool list.
- A one-sentence "what is Aigon" descriptor in agent memory and nothing public-facing or research-backed beyond it.

Three problems compound:

1. **No internal source of truth.** There is no living competitive-analysis artifact that captures the state of the space — what exists, how each tool approaches the workflow, where Aigon sits. Without it, the public page drifts and we keep re-doing the same lookups.
2. **The public comparison overclaims.** Feature-checkmark matrices imply Aigon "has X and they don't" when the real story is *philosophical difference of approach* (orchestration via tmux/CLI vs direct API calls; explicit per-feature model selection vs auto; spec-driven lifecycle vs task board; etc.). The user wants a public page that compares *approach to each capability*, not feature presence/absence.
3. **No clear category articulation.** "Agent orchestration", "spec-driven dev tool", "AI dev workflow", "multi-agent IDE" — none of these terms are settled. We need to align Aigon's positioning to terminology others already use, with copy at multiple lengths (one-liner, one-paragraph, one-page) plus reusable chunks for marketing surfaces.

This research must produce the analytical foundation for **three downstream artifacts**: an internal competitive matrix, a revised public comparison page, and a positioning / "what is Aigon" page with reusable copy chunks. F238 is an input to this research and is expected to be rewritten or closed afterwards.

## Questions to Answer

### Category & positioning
- [ ] What terminology does the broader market use for tools in Aigon's space (e.g. "agent orchestration platform", "spec-driven dev framework", "AI coding agent harness", "multi-agent dev workflow")? Which term has the strongest existing mindshare and lowest ambiguity?
- [ ] Which existing category should Aigon align to, and which term should we adopt as primary in marketing copy? What evidence supports the choice?
- [ ] What is the most defensible one-line description of Aigon? (Must avoid feature-list framing.)
- [ ] What is the most defensible one-paragraph version? One-page version?
- [ ] What reusable copy chunks (3–7 of them) are needed for marketing surfaces — landing hero, social bio, README opener, conference abstract, llms.txt, AGENTS.md, repo description?

### Competitive landscape
- [ ] Who are the current relevant competitors in this space, in tiers — closest competitors, adjacent commercial agents, OSS alternatives, and tools we should *not* compare against (frameworks, methodologies, archived projects)?
- [ ] For each competitor: what is their primary unit of work, source-of-truth artifact, isolation model, multi-agent behavior, evaluation model, interface (IDE/TUI/CLI/web), pricing model, and open-source status?
- [ ] Have any new tools entered the space since the last landscape research (research-21)? Which ones warrant inclusion?
- [ ] Which tools that *were* relevant are no longer relevant (archived, discontinued, mindshare collapsed)?

### Philosophy / approach axes (for the public page)

**The axes are not fixed.** The list below is a starting point drawn from internal discussion, *not* a constraint. Examine how competitor products structure their own comparison pages and adopt, replace, merge, split, or rename axes based on what is genuinely used in the space. If the established vocabulary in this market frames things differently (e.g. "deployment model" instead of "isolation model", "human-in-the-loop posture" instead of "evaluation model"), prefer the established vocabulary. The deliverable is *the right 10 axes for this space*, not "validate these 10".

- [ ] What 10 axes best capture *philosophical differences in approach* — not feature presence/absence — across tools in this space? Starting suggestions (free to discard, replace, merge, split, or rename):
  - Orchestration model (CLI-in-tmux vs direct API calls vs IDE-embedded vs cloud-sandbox)
  - Model/agent selection (explicit per-feature vs auto-routing vs single-model)
  - Unit of work (spec / task card / session / branch / issue)
  - Source of truth (markdown specs / board cards / chat history / IDE project state / hosted)
  - Isolation model (git worktrees / branches / cloud sandbox / in-place)
  - Multi-agent behavior (parallel competition / dependency chains / sequential / single-agent)
  - Evaluation model (formal review / rubric / diff / none)
  - Interface (local Mac app / TUI / slash commands / CLI / web app / mixed)
  - State ownership (local files / hosted workspace / chat-only)
  - Pricing model (BYO subscriptions / platform fee / usage-based / free)
- [ ] What axes do competitor comparison pages (Cursor vs X, Cline vs X, Devin vs X, Kiro vs X, Aider's docs, etc.) actually use? Which of those should we adopt? Which Aigon-internal axes are idiosyncratic and should be dropped?
- [ ] Of the final 10, which 5 are most legible to a casual reader and belong on the public page? Which 5 stay internal-only?
- [ ] For each axis: how does Aigon's approach differ, and is there an honest framing where Aigon's choice is genuinely a *trade-off*, not a unilateral win?

### Honest weaknesses
- [ ] Where does Aigon's approach genuinely lose — what does each competitor do better, and for which user does that matter? (This goes in both the internal doc and the public "what Aigon doesn't do" section.)

### Recurring-update mechanism
- [ ] What is the right design for a recurring monthly feature that keeps the internal matrix fresh — what does it scan, where does it scan (web / specific sites / GitHub releases / Hacker News / Reddit r/LocalLLaMA / Twitter), and what output does it produce (matrix patch / new tool entries / change-log)?

## Scope

### In Scope
- All currently-relevant competitors in the agent-orchestration / spec-driven dev / multi-agent coding space.
- Category terminology research (what others call this space).
- Definition of 10 philosophy-based axes; selection of 5 for public.
- Multi-length positioning copy (one-line, one-paragraph, one-page) plus reusable chunks.
- Design of the monthly recurring-feature update mechanism (sources, output format).
- Synthesis of existing completed research (research-21, research-24, research-25) and F238's tool list as inputs.

### Out of Scope
- Implementing the internal `docs/competitive/` directory (separate feature).
- Rewriting `site/content/comparisons.mdx` (separate feature, supersedes F238).
- Writing the `docs/marketing/positioning.md` page (separate feature).
- Building the recurring-feature mechanism (separate feature, after design is approved here).
- Re-doing per-tool deep dives that research-24 / research-25 already cover — link to them.
- Marketing channel strategy, ad copy, SEO. (Positioning *content* is in scope; distribution is not.)

## Output

Based on the research findings, the following downstream features should be created:

- [ ] Feature: `competitive-internal-matrix` — Create `docs/competitive/` with the matrix, per-tool deep-dive entries, and honest-weaknesses section.
- [ ] Feature: `public-comparison-page-rewrite` — Rewrite `site/content/comparisons.mdx` around the 5 public philosophy axes (supersedes F238; F238 should be closed at that point).
- [ ] Feature: `aigon-positioning-page` — Create `docs/marketing/positioning.md` with one-liner / one-paragraph / one-page versions plus reusable copy chunks; update memory `project_standard_descriptor.md`, AGENTS.md, README, landing hero, llms.txt to use the canonical chunks.
- [ ] Feature: `recurring-competitive-refresh` — Recurring monthly feature that scans for new tools and proposes updates to the internal matrix.

## Related

- F238 `feature-238-merge-comparisons-extended-into-public-site.md` — input to this research; expected to be rewritten or closed after research lands.
- `research-21-coding-agent-landscape.md` (done) — prior landscape pass.
- `research-24-roocode-comparison.md` (done) — Roo Code deep dive.
- `research-25-opencode-comparison.md` (done) — OpenCode deep dive (tool now archived).
- `docs/comparisons-extended.md` — current internal extended doc (slated for deletion by F238 → will be replaced by `docs/competitive/`).
- `site/content/comparisons.mdx` — current public page.
- Memory: `project_standard_descriptor.md` — current canonical one-line descriptor.
- Memory: `project_recurring_features.md` — recurring-feature engine context for the monthly refresh design.
