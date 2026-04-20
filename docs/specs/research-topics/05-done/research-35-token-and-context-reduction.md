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

The output should distinguish clearly between:
- **Measured findings** backed by telemetry, prompt/config size measurements, command output inspection, or documented tool behavior.
- **Inferences** where direct measurement is unavailable.
- **Recommendations** that can become follow-up features without requiring implementation in this research topic.

## Questions to Answer

### Measurement
- [ ] Without adding new instrumentation in this topic, how many tokens does a "typical" feature cost end-to-end (implement + submit) for cc vs cx vs gg? Use existing artifacts first (`lib/telemetry.js`, workflow logs, agent-visible usage output, or vendor session summaries). If the current data cannot answer this, identify the exact missing fields and where they would need to be captured.
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
- [ ] For codex specifically, does `~/.codex/config.toml` (now 2000+ lines) get sent as context every session? Distinguish between "Codex reads this file locally for configuration" and "the model receives this file content as prompt context," because those are different cost mechanisms.
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
- [ ] Does each cx session re-send the entire `~/.codex/config.toml` (2000+ lines of project trust entries) as part of its system prompt? If this cannot be proven directly, record the strongest available evidence and the uncertainty level instead of asserting it.

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

## Evidence Expectations

- Every major claim should name its evidence source: repository file/command inspection, telemetry artifact, observed CLI behavior, or external documentation.
- When estimating savings, provide a rough method, such as prompt-size deltas, repeated-session overhead, or observed per-run token summaries. Exact token accounting is optional if the data is unavailable, but the estimation method must be explicit.
- Separate repo-local facts from cross-repo sampling. If using aigon / aigon-pro / farline / brewboard / jvbot as examples, state which repos were sampled and why.
- If a question cannot be answered confidently from available data, say so directly and recommend the smallest follow-up measurement feature needed to close the gap.

## Findings

Full per-agent findings live alongside this spec:

- `docs/specs/research-topics/logs/research-35-cc-findings.md`
- `docs/specs/research-topics/logs/research-35-cx-findings.md`
- `docs/specs/research-topics/logs/research-35-gg-findings.md`

### Consensus (cc + cx + gg)

1. **Root docs are oversized.** `CLAUDE.md` 287 lines, `AGENTS.md` 210 lines, heavy overlap (Module Map, Rules, Common Agent Mistakes). `CLAUDE.md` auto-loads every CC session. Cross-repo sampling (cx) shows aigon is the outlier: aigon-pro `AGENTS.md` is 76 lines, farline 25, jvbot 33.
2. **Command templates are mostly ceremony.** `feature-do.md` is 180 lines; ~70 of those are the "Worktree execution rules (MANDATORY)" + "Step 0: Verify workspace (MANDATORY)" blocks, paid every session on every hot template (`feature-do`, `feature-start`, `feature-eval`, `feature-review`). Profile placeholders (`{{TESTING_WRITE_SECTION}}`, `{{LOGGING_SECTION}}`, etc.) render full paragraphs even for "not applicable" variants.
3. **Hot modules are large and frequently read.** `lib/commands/feature.js` ~3900 lines, `lib/dashboard-server.js` ~1850, `lib/worktree.js` ~1500.
4. **AutoConductor polling is free.** `__run-loop` uses `spawnSync('sleep', ...)` and local file reads. The cost is session restarts, not the loop.
5. **Autopilot cold-starts amplify context load.** Every iteration pays the full orientation + template + spec cost again with zero carry-forward.
6. **Telemetry is insufficient to answer the cost questions cleanly.** No per-turn attribution, no context-load vs. mid-session split, telemetry corpus dominated by `implement` activity (cx:implement 94 sessions / 183M billable tokens vs cc:implement 54 / 1.5M).
7. **`~/.codex/config.toml` (2069 lines) is unproven as a prompt cost.** All three agents flagged the file; none could prove it is serialised into the model prompt. Best available evidence points to local CLI use; a proper audit is needed before any pruning work.

### Divergent views

- **Fleet cost multiplier.** cc says ~3× (architectural — each worktree is a fresh CLI with no shared context). gg measured ~2× token volume on aggregate but **near-identical dollar cost** (~$18 either way) because Fleet mixes cheaper models. Both are compatible: tokens scale linearly, dollars don't.
- **Memory pruning.** cc wants `MEMORY.md` pruned of retired-agent entries (mv, cu-as-retired). cx says memory is "worth pruning for correctness, but not the first win." gg does not mention it.
- **Prompt caching.** cx is the only agent pushing explicit Anthropic prompt-caching around the stable Claude prefix; cc notes observed cache-read dominance without recommending a structural change; gg does not cover it.
- **Duplicate context delivery paths.** cx uniquely calls out that `feature-do.md` inlines the spec but also teaches `aigon feature-spec` as a fallback, and some templates (`feature-review.md` Step 2) re-invoke it. cc's findings acknowledge the duplication exists; gg does not discuss it.

### Ranked token sinks (synthesised)

1. Root always-on docs duplication (`CLAUDE.md` + `AGENTS.md`) — high confidence, directly measurable.
2. Hot-template ceremony blocks (`feature-do/start/eval/review`) — high confidence, directly countable.
3. Autopilot cold-start per iteration — moderate confidence, mechanism clear.
4. Profile placeholder "not applicable" prose — moderate confidence, fixable per resolver.
5. Fleet parallelism (~2-3× multiplier) — high confidence, not reducible without changing Fleet semantics. Out of scope.
6. `~/.codex/config.toml` — low confidence this is a sink; needs audit before action.
7. Memory index bloat — low absolute impact; cheap to fix.

## Recommendation

Grouped into four follow-up features (implementation order reflects dependencies, not priority):

1. **`token-reduction-1-slim-always-on-context`** — Consolidate `CLAUDE.md` into `AGENTS.md`, collapse the "MANDATORY" ceremony in the four hot templates to a one-line invariant, make profile-placeholder "skip" variants render empty, remove duplicate `aigon feature-spec` paths, prune retired entries from the Claude memory index. **Directly actionable.**
2. **`token-reduction-2-telemetry-and-audits`** — Extend cc/cx/gg parsers in `lib/telemetry.js` with per-turn token emission + a `contextLoadTokens` bucket, link implement/review/eval/close sessions under a shared `workflowRunId`, commit a short `docs/` audit recording whether `~/.codex/config.toml` reaches the model prompt. Closes the measurement gap that blocks data-driven iteration on `1`, `3`, and `4`. **Directly actionable** (the telemetry work); the audit is **directly actionable but evidence-bounded** — deliverable is a documented conclusion with confidence level, not a guaranteed proof.
3. **`token-reduction-3-autopilot-context-carry-forward`** — Edit `lib/validation.js` so iterations 2+ of `--iterate` inject a bounded, deterministic summary of the previous iteration instead of paying the full cold-start cost. **Directly actionable.** Benefits from `2` shipping first so the win is measurable, but not blocked on it.
4. **`token-reduction-4-claude-prompt-cache-stable-prefix`** — Make Claude prompt-caching of the stable Aigon prefix explicit after `1` has trimmed it down. **Directly actionable, depends on `1`.** If the CC harness does not expose a stable way to set `cache_control`, the feature downgrades to a documented confirmation task rather than code change.

### Deferred / out of scope

- **Codex `model_reasoning_effort` tuning** — model-selection lever, explicitly out of research scope.
- **Splitting `lib/commands/feature.js` / `dashboard-server.js` / `worktree.js`** — target-repo refactor, explicitly out of research scope. Revisit once `2` gives real cost data per feature.
- **Fleet-mode cost sharing** — would change Fleet semantics; out of research scope.
- **Pruning `~/.codex/config.toml`** — deferred until the audit in `2` confirms whether it is actually sent as prompt context.

## Output

### Selected Features

| Feature Name | Description | Priority | Create Command |
|--------------|-------------|----------|----------------|
| token-reduction-1-slim-always-on-context | Consolidate CLAUDE.md into AGENTS.md; collapse MANDATORY ceremony in hot templates; empty-string "skip" placeholders; remove duplicate spec paths; prune memory index. | high | `aigon feature-create "token-reduction-1-slim-always-on-context"` |
| token-reduction-2-telemetry-and-audits | Per-turn token attribution in cc/cx/gg parsers; shared workflowRunId across implement/review/eval/close; Codex config prompt-context audit. | high | `aigon feature-create "token-reduction-2-telemetry-and-audits"` |
| token-reduction-3-autopilot-context-carry-forward | Iterations 2+ of the iterate loop inject a bounded deterministic summary of the previous iteration instead of cold-starting. | medium | `aigon feature-create "token-reduction-3-autopilot-context-carry-forward"` |
| token-reduction-4-claude-prompt-cache-stable-prefix | Explicit Anthropic prompt-caching around the slim stable Aigon prefix for CC sessions. | medium | `aigon feature-create "token-reduction-4-claude-prompt-cache-stable-prefix"` |

### Feature Dependencies

- `token-reduction-4-claude-prompt-cache-stable-prefix` depends on `token-reduction-1-slim-always-on-context` (cache the slim prefix, not the bloated one). Captured via `depends_on` in the feature 4 spec.
- Features 3 and 4 benefit from feature 2 landing first (measurable wins) but are not formally blocked on it.

### Not Selected

- **Splitting `lib/commands/feature.js` and other hot modules** — target-repo refactor, research topic explicitly put this out of scope. Revisit after feature 2 gives per-activity cost data.
- **Codex `model_reasoning_effort` tuning** — model-selection lever, out of topic scope.
- **Fleet cost-sharing redesign** — would change Fleet semantics, out of topic scope.
- **Pruning `~/.codex/config.toml` now** — deferred until the audit in feature 2 proves or disproves it is a prompt-context cost.
