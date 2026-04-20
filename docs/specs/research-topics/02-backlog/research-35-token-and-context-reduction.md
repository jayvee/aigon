# Research: token-and-context-reduction

## Context

The user regularly exhausts their 5-hour token-usage window when driving Aigon workflows with Claude Opus 4.7 and Codex gpt-5.4. The bottleneck may be any combination of:

1. **Agent prompt bloat** — Aigon's command templates (`templates/generic/commands/*.md`) inject long preambles, multiple mandatory steps, and placeholder sections that are re-read every session.
2. **Session context bloat** — when an agent runs `aigon feature-do`, the CLI prints the full spec body inline plus a large preamble. Each agent turn includes this inline payload, plus `AGENTS.md`, `CLAUDE.md` (~250 lines), `docs/architecture.md`, and any files the agent explores.
3. **Harness-level context** — each agent session also loads agent-specific skills, command files, and memory (`~/.claude/projects/<repo>/memory/*`). Many of these are static across sessions but get re-sent every turn.
4. **Aigon CLI output verbosity** — commands like `aigon feature-spec`, `aigon board`, `aigon research-spec` print long formatted output that agents then ingest into context.
5. **Codex-specific waste** — awaiters (now partially mitigated by `a092ef27`/`3db70a7a`), log-writing ceremony (partially mitigated by the same commits), re-reading specs from disk, and running discovery commands (`find`, `glob`, `ls`) when the spec already names the relevant files.
6. **Target-repo shape** — in repos the user is editing (aigon itself, aigon-pro, farline, brewboard, jvbot), what files are agents actually reading per feature? Are there large files, auto-loaded configs, or wide imports that pull in more than needed?
7. **Autonomous-loop amplification** — AutoConductor spawns fresh agent sessions every iteration in Autopilot mode. Every retry pays the full context-load cost again. Are there easy wins in carrying forward a distilled context vs. cold-starting each iteration?

This research should produce a **ranked, concrete list of quick wins and medium-effort wins** to cut tokens-per-feature, with rough expected savings for each.

## Questions to Answer

### Measurement
- [ ] Without instrumentation, how many tokens does a "typical" feature actually cost end-to-end (implement + submit) for cc vs cx vs gg? Is the existing telemetry (`lib/telemetry.js`) enough to answer this, and if not, what's missing?
- [ ] Where is time/cost skewed — on the first few model turns (context load), mid-implementation (exploration and re-reads), or post-submit (log writing, ceremony)?
- [ ] Which Aigon workflows are the most expensive per run (e.g. Fleet 3-agent feature, solo Drive feature, research-autopilot)? Ranked list please.

### Prompt & template wins (Aigon harness)
- [ ] Are `templates/generic/commands/feature-do.md`, `feature-start.md`, `feature-eval.md`, `feature-review.md` each larger than they need to be? What can be cut without changing behaviour? (Aim: measure each in lines / tokens, identify % that's ceremony vs. actionable.)
- [ ] Do the `AGENTS.md` / `CLAUDE.md` files this repo injects at session start contain content that's re-read every turn but only relevant to orientation? Could any of it move to an "on-demand" skill the agent loads when needed, rather than always-loaded context?
- [ ] How much does the "Step 0: Verify your workspace (MANDATORY)" block + the "Worktree execution rules (MANDATORY)" block cost per session? Are they strictly necessary for every session, or could they be collapsed into one short rule?
- [ ] Does the `aigon feature-spec <ID>` command printing a spec inline duplicate content the agent already has in its initial prompt? When does that duplication happen?
- [ ] Are there placeholder sections (`{{TESTING_WRITE_SECTION}}`, `{{LOGGING_SECTION}}`, etc.) that render as full paragraphs even when the right answer is "skip this step"?

### Harness / session shape wins
- [ ] Does `aigon install-agent` write more skill files than any given agent needs per session? Specifically: how many `.claude/skills/` files does a cc session actually load into context when running `feature-do`, vs. how many are installed?
- [ ] For codex specifically, does `~/.codex/config.toml` (now 2000+ lines) get sent as context every session? If yes, this alone may be a massive hidden cost.
- [ ] Are the `CLAUDE.md` auto-memory files (`~/.claude/projects/<repo>/memory/*`) loaded in their entirety every session, or only the `MEMORY.md` index? If the full set is loaded, can we prune aggressively?
- [ ] For repos using cc's plan mode, is the plan content re-read on every turn or only once?
- [ ] Are there opportunities to use Claude's prompt-caching explicitly for the stable portions of the prompt (templates, CLAUDE.md, etc.)?

### Workflow / orchestration wins
- [ ] Does Fleet mode (3 agents running the same feature) cost ~3× a solo run, or is there shared overhead that makes it cheaper? What's the actual cost multiplier?
- [ ] AutoConductor's `__run-loop` polls every 30 seconds. Is the polling loop itself eating tokens (does it spawn model calls)? If yes, what's the cheapest replacement?
- [ ] When a feature hits `submitted`, how much additional cost is incurred by the review + eval + close cycle? Where in that cycle can we cut without losing the value of reviews?
- [ ] Are there Aigon commands that spawn a model call when they could be deterministic (e.g. `aigon next` — does it use the LLM, and if so, could it be rule-based instead)?

### Target-repo shape wins
- [ ] Across aigon / aigon-pro / farline / brewboard / jvbot, which files are most frequently read by agents during feature implementation? (Use git history / log files as a proxy.)
- [ ] Are any of those "hottest" files unnecessarily large — e.g. `lib/commands/feature.js` at ~2860 lines? Could they be split so agents only load the section they need?
- [ ] Is `CLAUDE.md` itself too long at this point? How much of it is load-bearing context vs. reference material that could live elsewhere?

### Codex-specific extra wins
- [ ] Beyond `a092ef27` / `3db70a7a`, what else in codex-specific behaviour wastes tokens? (Awaiters still run occasionally; reasoning-effort set to "medium" globally.)
- [ ] Would dropping `model_reasoning_effort = "medium"` to `"low"` for routine features meaningfully cut cost without hurting quality on simple tasks?
- [ ] Does each cx session re-send the entire `~/.codex/config.toml` (2000+ lines of project trust entries) as part of its system prompt? If yes, pruning that file or moving trust-entries to a separate gitignored sidecar is high-leverage.

## Scope

### In Scope
- Aigon CLI templates, prompts, and harness (templates/, lib/agent-prompt-resolver.js, lib/profile-placeholders.js, install-agent paths)
- Agent-side config files that Aigon writes or installs (`.codex/`, `.claude/`, `.cursor/`, `.gemini/`, `.agents/skills/`)
- Global agent configs that Aigon touches (`~/.codex/config.toml`) where the content is Aigon-generated
- Autonomous-loop orchestration (AutoConductor) cost patterns
- CLAUDE.md / AGENTS.md size and content distribution
- Cross-cutting Aigon commands whose output becomes agent context (`feature-spec`, `board`, `feature-list`, `research-spec`)
- Identifying which files in active repos are the hottest read paths for agents

### Out of Scope
- Model selection (which model to use for which task) — a separate cost lever orthogonal to context-size reduction.
- Rewriting agent behaviour inside Claude Code / Codex / Gemini / Cursor themselves — we can only shape what we send them.
- Target-repo refactors (e.g. breaking up `lib/commands/feature.js`) — if the research finds this is the hottest read-path, a follow-up feature would tackle it; don't implement here.
- Per-agent pricing or rate-limit engineering — this research is about token volume, not vendor-side cost.
- Writing any of the fixes themselves — this research only proposes ranked wins.

## Findings
<!-- Document discoveries, options evaluated, pros/cons -->

## Recommendation
<!-- Summary of recommended approach based on findings -->

## Output
<!-- Based on your recommendation, create the necessary feature specs by running the `aigon feature-create "<name>"` command. Link the newly created files below. -->
- [ ] Feature:
