---
aigon_id: R66
complexity: high
transitions:
  - { from: "in-evaluation", to: "done", at: "2026-05-08T02:29:35.687Z", actor: "cli/research-close" }
  - { from: "inbox", to: "backlog", at: "2026-05-07T14:34:44.606Z", actor: "cli/research-prioritise" }
---

> Historical: Aigon Pro was merged into OSS by F693. This spec describes the
> tiered architecture as it existed; Aigon has no paid tier.


# Research: reduce-token-usage

## Context

Running Aigon across multiple repositories burns significant tokens — in system prompts, agent instruction files, startup hooks, and context loaded per feature. This cost compounds across every agent spawned in Fleet mode, every code review, every spec revision. There are two dimensions to address: (1) structural changes to Aigon itself that could benefit all users (e.g., slimmer default instructions, smarter context loading, compression hooks), and (2) project-level optimizations for specific repos like `aigon` and `aigon-pro` that only affect the maintainer's own development practice. Several open-source tools claim to reduce token consumption through compression, reformatting, or instruction pruning. This research should surface what's actually worth adopting, what's placebo, and what Aigon could build natively.

## Questions to Answer

### Current token profile in Aigon
- [ ] What is the typical token footprint of an Aigon session? (CLAUDE.md, system prompt, hooks, workflow docs, memory files)
- [ ] Which files are loaded automatically on every session start vs. on demand?
- [ ] How large are the agent instruction files in `.aigon/docs/agents/` and `docs/architecture.md`? Are any of them unnecessarily verbose?
- [ ] What does the startup hook inject, and how large is it?
- [ ] In Fleet mode, how many agents are spawned per feature, and does each one receive a full copy of the system context?
- [ ] Where is context re-sent redundantly (e.g., per-turn vs. once at start)?

### Open-source token reduction tools
- [ ] **RTK (Rust Token Killer)** — https://github.com/rtk-ai/rtk: What does it actually do? (pre-process/strip text before sending to LLM?) Is it a CLI, SDK, or proxy? Does it degrade output quality? What benchmarks exist?
- [ ] **Caveman Claude** — https://github.com/juliusbrussee/caveman: What compression strategy does it use? (pidgin English, abbreviations, semantic compression?) How is it applied — as a system prompt modifier, context pre-processor, or prompt wrapper? What's the claimed token reduction %? Any quality trade-offs?
- [ ] **context-mode** — https://github.com/mksglu/context-mode: What problem does it solve? Is it a Claude Code extension/hook or standalone tool? What does it configure?
- [ ] What other popular token-reduction tools or techniques exist? (LLMLingua, Selective Context, prompt compression libraries, context window management frameworks)
- [ ] Which of these integrate naturally with Claude Code's hook system vs. requiring external wiring?

### What could be built INTO Aigon (for all users)
- [ ] Could Aigon offer a `verbosity` config option (e.g., `compact`, `standard`, `verbose`) that adjusts instruction file length at spec/start time?
- [ ] Could the workflow docs and agent instructions be chunked or lazy-loaded — only injected when relevant to the current step?
- [ ] Is there a hook point (e.g., `pre-agent-start`) where Aigon could compress or trim the context before handing off to the agent CLI?
- [ ] Could Aigon track per-feature token usage via its telemetry system and surface cost in the dashboard, enabling users to identify expensive patterns?
- [ ] Would a "slim mode" for CLAUDE.md — stripping comments, collapsing whitespace — meaningfully reduce tokens without losing semantics?
- [ ] Can Aigon's memory system be pruned automatically (e.g., expire stale memories, deduplicate) to reduce what gets loaded each session?

### What could be built into target repos (personal development practice)
- [ ] In `aigon` and `aigon-pro`, which CLAUDE.md sections are rarely referenced and could be cut or moved to on-demand docs?
- [ ] Would adopting a compressed instruction style (terse bullet rules vs. prose explanations) meaningfully reduce tokens?
- [ ] Could a local hook in `aigon-pro` apply context-mode or Caveman-style compression to agent instructions before they are sent?
- [ ] Is there a pattern for splitting CLAUDE.md into a small "always load" core and larger "load on demand" sections?

### Measurement and validation
- [ ] How can token usage be measured before/after changes? (Claude Code session cost, API logs, observability tools)
- [ ] What is an acceptable quality trade-off threshold — are there tasks where compression causes visible regressions?
- [ ] Is there an existing benchmark suite for Aigon agent quality that could detect regressions from instruction trimming?

## Scope

### In Scope
- Token footprint analysis of Aigon's current instruction and context loading structure
- Evaluation of RTK, Caveman Claude, and context-mode tools
- Survey of other popular token-reduction approaches (LLMLingua, etc.)
- Aigon-native features: verbosity modes, lazy context loading, cost tracking in dashboard
- Repo-specific optimizations for `aigon` and `aigon-pro` maintainer workflow
- Integration with Claude Code hooks for compression

### Out of Scope
- Switching LLM providers to reduce cost (separate concern)
- Rewriting agent instruction content for quality improvements (separate from token reduction)
- General prompt engineering best practices unrelated to token count

## Inspiration
- RTK (Rust Token Killer): https://github.com/rtk-ai/rtk
- Caveman Claude: https://github.com/juliusbrussee/caveman
- context-mode: https://github.com/mksglu/context-mode
- LLMLingua (Microsoft): https://github.com/microsoft/LLMLingua
- Aigon telemetry: `lib/telemetry.js`
- Aigon agent instructions: `.aigon/docs/agents/`
- Aigon development workflow: `.aigon/docs/development_workflow.md`

## Findings

### Current Token Profile in Aigon
- **Agent Instruction Files**: Located in `.aigon/docs/agents/`, these files range from ~1,000 to ~1,500 words each (approx. 1,300–2,000 tokens), totaling over 7,200 words across all agent types and standard workflows.
- **Workflow Docs**: `.aigon/docs/development_workflow.md` is ~800 words.
- **Hooks & Memory**: The project leverages over 70 `.cursor/commands/` and `.cursor/rules/` markdown files that act as contextual memory and skills. Loading all of these per-session without pruning contributes significantly to token burn. No central massive `CLAUDE.md` or `GEMINI.md` was found in the project root, but the aggregation of specialized instruction files essentially acts as one.
- **Telemetry**: Aigon tracks file operations and events in `lib/telemetry.js` and `.aigon/telemetry/` but does not currently parse or track API token counts or costs per session.

### Open-source Token Reduction Tools
1. **RTK (Rust Token Killer)**: A high-performance CLI proxy that filters standard output from CLI commands (strips comments, truncates logs, deduplicates). Pros: Claims 60-90% savings for `git` or test runners. Cons: Only works on shell executions, not native LLM tools (like `Read` or `Glob`). 
2. **Caveman Claude**: An MCP skill/plugin that rewrites output (and memory files) into terse "caveman-speak" (removing filler words). Pros: Significant token reduction (up to 75% for output). Cons: Unnatural, blunt UX that sacrifices conversational nuance.
3. **context-mode**: An MCP server that manages the context window by injecting a "Session Guide" using SQLite tracking to prevent state loss during context compaction. Also sandboxes command execution so huge logs aren't dumped into the raw context window. Pros: Exceptional at solving the "lost state" issue.
4. **LLMLingua**: Microsoft's prompt compression model using a smaller LLM to calculate token perplexity and strip low-information density text. Pros: Great for RAG or API payloads (up to 20x). Cons: Requires running a local ML model (like LLaMA or GPT2) just to compress prompts, which is too heavy to run natively inside a fast CLI workflow.

### What Could be Built INTO Aigon
- **Token Telemetry**: Aigon already has a robust telemetry retention system. Tracking per-session token cost would allow users to isolate expensive behaviors.
- **Lazy Context Loading**: Instead of injecting all `.cursor/commands/` or `.aigon/docs/agents/` into the system prompt at start-up, Aigon could lazily inject the rules *only* when the agent switches to that phase (e.g., only loading research rules during `aigon research-do`).

## Recommendation

Synthesised from cc and cx findings (gg produced no findings):

**Both agents converge on a structural fix, not lossy compression.** Caveman-speak corrupts Aigon's document-driven workflow (specs → reviews → findings consumed by other agents/humans); LLMLingua adds runtime/latency cost without auditability. Both are wrong for the speech mode.

**The four-step ROI ladder, all consensus:**

1. **Surface token cost from existing telemetry.** `.aigon/telemetry/*.json` already records per-turn input/output/cache-read/cache-write/billable breakdowns — 27+ files (152KB) are dark. cc calls this "the single largest free win"; cx says "you can't optimise what you can't measure". Highest ROI per LOC. Foundational for measuring everything below.

2. **Slim the always-loaded agent instruction files.** `.aigon/docs/agents/claude.md` is 144 lines / ~1,900 tokens; Codex `AGENTS.md` is 327 lines / ~7,800 tokens. ~70-75% of that content is workflow how-to that's only relevant when actually running a command. A 30-50-line core can carry the universal rules. Pair with a `instructions_verbosity: compact | standard | verbose` config that also drives template rendering for non-slash agents (cx, op, km) where templates are inlined at launch.

3. **Lazy-load workflow context on demand.** Two complementary mechanisms: (a) extract Drive/Fleet/Research how-to into `aigon:*-workflow` Skills (Anthropic's progressive disclosure: ~100 tokens metadata always-on, body fetched on trigger); (b) `UserPromptSubmit` hook that injects active feature-spec context only when the user references a feature ID, instead of carrying it eagerly.

4. **Pilot RTK and context-mode as opt-in adapters.** Both research agents converge on these as the most credible external systems but warn against vendoring wholesale (Elastic 2.0 license, state overlap with our `.aigon/workflows/` SQLite, surprise-rewrite failure modes). Allowlist-driven, with raw-output recovery escape hatches.

**Notable cc-only insights worth keeping in mind during implementation:**
- Anthropic prompt caching is the largest single lever already shipped (cache reads cost 0.1× input). Cache-friendly ordering of stable content matters more than compression.
- Skills are a token-shaped redesign, not just a feature — the right home for the workflow how-to that comes out of feature 2.
- Fleet agents could route grep/file-search to the built-in Haiku Explore subagent for ~15× cost reduction on those steps. Not in this set, but a future low-effort win.

**Reject:** Caveman, LLMLingua-in-launch-path, Fleet context sharing.

## Output

### Set Decision

- Proposed Set Slug: `reduce-tokens`
- Chosen Set Slug: `reduce-tokens`

### Selected Features

| ID | Feature Name | Description | Priority | Create Command |
|----|--------------|-------------|----------|----------------|
| 434 | reduce-tokens-1-cost-dashboard | Surface per-session/per-feature/per-agent token cost from existing telemetry; outlier detection for high-context sessions, noisy commands, weak cache reuse, Fleet multipliers | high | `aigon feature-create "reduce-tokens-1-cost-dashboard" --set reduce-tokens` |
| 435 | reduce-tokens-2-slim-instructions | Trim always-loaded agent docs to ~30–50-line core; ship `instructions_verbosity: compact \| standard \| verbose` that also drives template rendering for non-slash agents | high | `aigon feature-create "reduce-tokens-2-slim-instructions" --set reduce-tokens` |
| 436 | reduce-tokens-3-lazy-workflow | Extract Drive/Fleet/Research how-to into `aigon:*-workflow` Skills + `UserPromptSubmit` hook for spec-by-ID injection | high | `aigon feature-create "reduce-tokens-3-lazy-workflow" --set reduce-tokens` |
| 437 | reduce-tokens-4-output-compression | Opt-in RTK / context-mode adapters with allowlisted command categories, raw-output recovery, before/after telemetry comparison | medium | `aigon feature-create "reduce-tokens-4-output-compression" --set reduce-tokens` |

### Feature Dependencies

DAG (not strict serial — #4 branches off #1 directly, doesn't need #2/#3):

- 435 (slim-instructions) depends on 434 (cost-dashboard) — need telemetry to detect regressions when trimming
- 436 (lazy-workflow) depends on 435 (slim-instructions) — Skills extraction reuses the verbosity scaffolding
- 437 (output-compression) depends on 434 (cost-dashboard) — pilot needs telemetry to measure RTK/context-mode wins

### Not Selected

Dropped during refactor (user requested 3-4 max, drop "low" priorities):

- **anthropic-cache-audit** (cc, medium) — Quick audit of Aigon-internal Anthropic SDK calls for `cache_control` placement. Genuine high-leverage but small scope; revisit as a follow-up after the set lands.
- **haiku-subagent-guidance** (cc, medium) — One-line directive to prefer the built-in Explore (Haiku) subagent for grep/search. Doc change, not feature-worthy.
- **pre-agent-context-hook** (cx, medium) — Structured `pre-agent-start` hook for measuring/transforming prompt sections. Subsumed by the rendering plumbing in feature 717.
- **command-output-budget-lints** (cx, medium) — Warn on large CLI command output. Premature without 434's measurement.
- **context-compression-benchmark-suite** (cx, medium) — Representative tasks comparing full vs compact vs RTK vs context-mode. Premature without 437's pilot; will be needed to gate that pilot's wins.
- **precompact-snapshot-hook** (cc, low) — `PreCompact` priority-tiered state snapshot. Pattern noted from context-mode; future follow-up.
- **memory-and-instruction-prune** (cx, low) — Detect duplicate/stale `AGENTS.md` / `CLAUDE.md` / memory entries. Future hygiene tooling.
- **compact-response-style** (cx, low) — Per-agent terse-response preference for low-stakes status output. cc rejected the broader caveman-speak premise; keep as a future opt-in if anyone asks.

### Stub Cleanup

Two empty stub specs (`feature-aigon-token-telemetry.md`, `feature-aigon-lazy-context.md`) in `01-inbox/` from the prior partial evaluation were deleted — they were unfilled templates and overlapped with features 434 and 436.
