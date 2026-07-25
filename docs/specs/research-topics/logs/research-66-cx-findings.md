# Research Findings: reduce token usage

**Agent:** Codex (cx)
**Research ID:** 26
**Date:** 2026-05-08

---

## Key Findings

### 1. Current Aigon token profile

I measured the current repo state and the OSS `~/src/aigon` repo because Aigon's OSS repo owns most prompt, agent-launch, hook, and telemetry code while this private repo owns Pro analytics.

Approximate token counts use `words * 1.33`; exact tokenizer counts would be better, but these figures are enough to rank sinks.

| Surface | Local evidence | Approx tokens | Notes |
|---|---:|---:|---|
| `aigon/AGENTS.md` | 47,206 bytes, 327 lines | 7,799 | Biggest always-on project instruction file for Codex; Codex official docs say it reads the global/project `AGENTS.md` chain once per run/session and caps project docs at 32 KiB by default. |
| `aigon/docs/architecture.md` | 55,901 bytes, 643 lines | 8,868 | Not automatically loaded by Aigon itself, but `AGENTS.md` and agent notes tell agents to read it for structural changes, so it becomes frequent on-demand context. |
| `aigon/CLAUDE.md` | 4,798 bytes, 35 lines | 779 | Already slimmed since earlier research; no longer the large 287-line sink from research 35. Claude official docs say `CLAUDE.md` loads at session start and recommends under 200 lines. |
| `aigon/.aigon/docs/agents/*.md` | 6 files | 1,323-1,934 each | On-demand by instruction, not loaded by Aigon launch code unless an agent reads them. |
| `aigon-pro/AGENTS.md` | 3,332 bytes, 75 lines | 646 | Small; not the main problem. |
| `aigon-pro/.agents/skills/*` | 40 skill files | ~32K total | Codex skill catalog is installed, but per current session the UI exposes skill names/descriptions and loads bodies only when used. The one active `research-do` skill was 1,115 approx tokens. |
| Installed command files in `aigon-pro` | `.claude`, `.gemini`, `.cursor`, `.agents` | ~194K total on disk | This is installation footprint, not automatic prompt footprint. The risk is discovery/catalog overhead and accidental reads, not every file being sent each turn. |

Launch/context plumbing:

- For slash-command agents (`cc`, `gg`, `cu`), `lib/agent-prompt-resolver.js` usually passes a short command such as `/aigon:feature-do {featureId}` and lets the agent command file resolve locally.
- For non-slash agents (`cx`, `op`, `km`), `lib/agent-prompt-resolver.js` inlines the canonical template body from `templates/generic/commands/`. This is reliable, but means every Codex/OpenCode/Kimi Aigon-spawned session receives the full command template at launch.
- `aigon project-context` currently injects only 221 bytes / ~28 tokens in this repo: a small Aigon doc pointer block. `aigon check-version` prints 41 bytes. These startup hooks are no longer large.
- Aigon's classic `docs/aigon-hooks.md` mechanism supports pre/post command hooks only. Agent-native hooks are installed through per-agent config: Claude `SessionStart`, `SessionEnd`, and `Stop`; Gemini `SessionStart` and `AfterAgent`; Cursor `sessionStart`; Codex config only, no Aigon-installed hook file today.
- Fleet mode creates one independent session per agent. For research 66, `aigon research-do 26` shows `cc`, `cx`, and `gg` findings files. There is no shared model context between agents.

Telemetry snapshot:

- Local telemetry corpus: 443 JSON records, 383 with token data.
- `aigon`: median total tokens per telemetry record ~3.49M; p90 ~18.16M.
- `aigon-pro`: median ~2.11M; p90 ~10.84M.
- By agent: `cc` median ~5.46M with huge cache-read totals; `cx` median ~181K but p90 ~7.26M and high `contextLoadTokens` on recent sessions.
- Caveat: current telemetry mixes input, output, cache-read, and sometimes provider-specific totals. It is good for outlier detection but still weak for per-turn context-load attribution.

The immediate profile has changed since prior research 35: `CLAUDE.md` is already slim, but `AGENTS.md`, command-template inlining, large architecture docs, command output, and Fleet multiplication remain meaningful sinks.

### 2. Files loaded automatically vs. on demand

Automatic or near-automatic:

- Codex reads `AGENTS.md` chains before work. Official Codex docs say it reads global and project `AGENTS.md`/override files once per run or launched TUI session, walking from project root to cwd, with `project_doc_max_bytes` defaulting to 32 KiB.
- Claude Code reads `CLAUDE.md` at session start; Claude docs state `CLAUDE.md` and auto memory are loaded at every conversation start, and files in subdirectories can be lazy-loaded when accessed.
- Aigon-installed Claude/Gemini/Cursor hooks run on session start and can add context. In this repo the Aigon hook output is tiny.
- Non-slash Aigon agent launches inline full command bodies, so the active command template is automatic for `cx`, `op`, and `km`.

On demand:

- `.aigon/docs/agents/*.md`, `docs/architecture.md`, and `.aigon/docs/development_workflow.md` are pointed to by project instructions; they are not injected by Aigon launch code.
- Installed command/skill files are command definitions. They become context when the agent invokes or opens one, not simply because they exist.
- Full source files and test output enter context through tool calls. This is where RTK/context-mode-style tools can help.

### 3. Open-source token-reduction tools

#### RTK (Rust Token Killer)

RTK is a Rust CLI proxy for command-output compression. Its README says it filters command outputs before they reach LLM context, applies smart filtering/grouping/truncation/deduplication, supports 100+ commands, and claims 60-90% savings on common development commands. It can transparently rewrite Bash calls for Claude Code/Gemini/Cursor via hooks; for Codex it currently uses instructions (`AGENTS.md` + `RTK.md`) rather than an Aigon-style native hook.

Pros:

- Best fit for Aigon's noisy shell surfaces: tests, `git status`, `git diff`, `rg`, `find`, `ls`, logs.
- Has per-command savings analytics via `rtk gain`, useful for validating adoption.
- The project explicitly documents correctness vs token savings: preserve detailed output when verbose flags show user intent.
- Integrates naturally with hook-capable agents and can be used explicitly (`rtk test`, `rtk git status`) in non-hook paths.

Cons/risks:

- It does not affect built-in read/search tools that bypass shell hooks.
- Transparent rewrites can surprise workflows; several real-world discussions report command mismatch/failure modes.
- Aigon must keep raw-output escape hatches because compressed test/build output can hide detail needed for debugging.

Verdict: strong opt-in candidate for shell-output compression, especially in Aigon's dev workflow, but do not make it default until Aigon has a benchmark/quality gate and a raw-output fallback.

#### Caveman Claude

Caveman is a cross-agent skill/plugin that compresses assistant communication style. The repo describes it as a skill that cuts tokens by terse "caveman" wording and offers Claude hooks/statusline/MCP shrink options, plus install support for many agents including Claude Code, Gemini, Codex, Cursor, and OpenCode.

Pros:

- Very easy to trial as a personal workflow preference.
- Targets output tokens and conversational verbosity, not just tool output.
- Has broad agent install support.

Cons/risks:

- It intentionally degrades human-readable prose. That is a bad default for Aigon specs, reviews, findings, and user-facing docs where clarity is part of the output quality.
- It is a style modifier, not structural context management; it will not fix repeated `AGENTS.md`, command-template, spec, or large-file loads.

Verdict: useful personal toggle for low-stakes chat/status output; not appropriate as an Aigon default. Aigon could support "compact response style" in agent config, but should not enforce caveman-style language.

#### context-mode

context-mode is an MCP/server + hooks system that sandboxes tool output and indexes/retrieves content outside the main context window. The README claims ~98% savings with hooks and ~60% without hooks, supports Claude Code/Gemini/Cursor/OpenCode/Codex and more, and registers sandbox tools such as execute, batch execute, index, search, fetch-and-index, plus stats/doctor/insight tools.

Pros:

- Closer to the architectural fix than RTK: it avoids dumping large tool outputs and provides searchable indexed content.
- Strong hook story for Claude Code; supports Codex CLI hooks according to its current platform table.
- Good match for Aigon's large-doc and large-log problem: index `docs/architecture.md`, big command outputs, benchmark logs, and query only relevant chunks.
- Includes diagnostics and savings stats, which helps evaluation.

Cons/risks:

- More invasive than RTK: MCP server, SQLite/FTS, routing instructions, hooks, persistent session data.
- It changes the agent's tool-use path, so Aigon needs a controlled pilot before recommending it.
- For Aigon templates, relying on the model to choose context-mode tools is weaker than Aigon itself routing known large operations through a structured API.

Verdict: best candidate for a serious pilot. Aigon should not blindly vendor it, but should add an integration/benchmark path and consider native "sandboxed command output + indexed retrieval" features inspired by it.

#### LLMLingua / prompt-compression libraries

Microsoft LLMLingua uses smaller models to remove less important prompt tokens and reports up to 20x compression with minimal performance loss; LLMLingua-2 targets task-agnostic compression. Selective Context similarly prunes redundant context to make prompts more compact.

Pros:

- Strong academic basis for compressing long static/reference text.
- Useful for offline summarization or creating compact docs from long research/context artifacts.

Cons/risks:

- Adds model/runtime dependencies and latency.
- Token-level compressed prompts can be hard for humans to audit.
- It is risky for hard requirements, safety rules, feature specs, and code review evidence; dropped "unimportant" tokens may be exactly the acceptance criterion or edge case that matters.

Verdict: do not put LLMLingua-style compression in the critical launch path. Use extractive, auditable compression first: chunk, retrieve, summarize with citations, and preserve raw originals.

### 4. What Aigon should build natively

High-confidence native work:

- **Context budget telemetry:** extend current telemetry/stats to show first-turn/context-load tokens, tool-output tokens, cache-read/cache-write, per-agent, per-workflow, and per-command-output buckets. Pro can make this visible in Insights.
- **Prompt/context budget checks:** a deterministic `aigon context-budget` command that counts instruction files, active command templates, spec size, startup hook output, and common loaded docs before spawning agents.
- **Verbosity modes:** `compact`, `standard`, `verbose` should select command-template density and optional explanatory sections. This should be deterministic template rendering, not lossy model compression.
- **Lazy context packs:** move long explanations from hot command bodies into on-demand docs/skills. Command templates should contain only the invariant and a pointer.
- **Hook point before agent launch:** add a `pre-agent-start`/`pre-context-render` hook that receives the resolved prompt sections as structured JSON and can measure, reject, or transform optional sections before launch.
- **Tool-output compression adapter:** add first-class config for RTK/context-mode/none, with an allowlist per command category and raw-output fallback links.
- **Memory/doc pruning:** add stale memory detection and duplicate instruction detection. Claude docs recommend concise CLAUDE.md files and path-scoped rules for large projects; Aigon can lint for that.
- **Prompt-cache-friendly ordering:** keep static content first and dynamic content last. Anthropic prompt caching docs say static tools/system/context/examples should be placed at the beginning and cache breakpoints at the end of reusable content. OpenAI prompt caching similarly rewards repeated long prefixes.

Lower-confidence or deferred:

- Lossy compression of feature specs or safety rules.
- Auto-enabling external hook systems globally.
- Fleet context sharing between agents. It would reduce cost but breaks Fleet's independent-agent value.

### 5. Repo-specific optimizations for `aigon` and `aigon-pro`

For `aigon-pro`:

- Root `AGENTS.md` is already compact at ~646 approximate tokens. Do not spend much effort there.
- The installed command/skill footprint is huge on disk but not automatically loaded; avoid treating file count as token count.
- Pro's best opportunity is analytics: turn the existing telemetry into actionable context/cost insights.

For `aigon`:

- `AGENTS.md` is still large enough to hit Codex's default 32 KiB project-doc cap when combined with global/nested instructions. It should be split into a small always-on core and task-specific docs.
- `docs/architecture.md` is valuable but large. Add a short module index and path-scoped "when to read this" chunks so agents do not ingest 643 lines for narrow changes.
- Keep `CLAUDE.md` as the small import/pointer pattern. Claude docs explicitly recommend importing `AGENTS.md` from `CLAUDE.md` if a repo already uses `AGENTS.md`, but the imported content still enters context, so the imported target must stay compact.
- Non-slash prompt inlining for `cx/op/km` should render compact variants by default and point to on-demand detail.

### 6. Measurement and validation

Recommended measurement method:

1. Record a baseline for representative workflows: solo feature, Fleet feature, research Fleet, code review, Autopilot iteration.
2. For each session, capture first-turn input/context-load, fresh input, cached input, output, tool-output bytes/tokens, model, agent, workflow phase, and cost.
3. Add command-output instrumentation for `aigon` CLI output that agents see: `feature-do`, `research-do`, `feature-spec`, `board`, `stats`, test commands, build commands.
4. Compare against a quality benchmark: existing `lib/perf-bench.js`, recurring benchmark specs, and a small fixture suite where agents must fix bugs from full vs compressed outputs.
5. Use thresholds: default compression should preserve task success and review quality within a tight regression bound. If no benchmark exists for a surface, keep compression opt-in.

Acceptable trade-off:

- Safe by default: deterministic truncation of passing test noise, duplicated logs, ANSI/progress bars, and repeated file lists.
- Opt-in only: lossy rewriting of requirements, specs, code review comments, security scan output, and failing-test details.
- Always provide raw recovery: saved raw logs/transcripts or a command to re-run uncompressed.

## Sources

Local evidence:

- `docs/specs/research-topics/03-in-progress/research-66-reduce-token-usage.md`
- `docs/specs/research-topics/05-done/research-35-token-and-context-reduction.md`
- `/Users/jviner/src/aigon/lib/agent-prompt-resolver.js`
- `/Users/jviner/src/aigon/lib/commands/research.js`
- `/Users/jviner/src/aigon/lib/hooks.js`
- `/Users/jviner/src/aigon/lib/telemetry.js`
- `/Users/jviner/src/aigon/templates/agents/{cc,cx,gg,cu,op,km}.json`
- Measurements run locally with `find`, `wc`, and a Node word-count script on `AGENTS.md`, `CLAUDE.md`, `.aigon/docs`, `.agents/skills`, `.claude`, `.gemini`, `.cursor`, and telemetry JSON.

External sources:

- RTK README: https://github.com/rtk-ai/rtk
- RTK contributing/design notes: https://github.com/rtk-ai/rtk/blob/master/CONTRIBUTING.md
- Caveman README: https://github.com/juliusbrussee/caveman
- context-mode README/platform table: https://github.com/mksglu/context-mode
- LLMLingua README: https://github.com/microsoft/LLMLingua
- Microsoft Research LLMLingua article: https://www.microsoft.com/en-us/research/?p=987321
- Selective Context repo: https://github.com/liyucheng09/Selective_Context
- Selective Context paper: https://arxiv.org/abs/2310.06201
- Claude Code hooks docs: https://code.claude.com/docs/en/hooks
- Claude Code hooks guide: https://code.claude.com/docs/en/hooks-guide
- Claude Code memory docs: https://code.claude.com/docs/en/memory
- Anthropic prompt caching docs: https://docs.claude.com/en/docs/build-with-claude/prompt-caching
- OpenAI Codex `AGENTS.md` docs: https://developers.openai.com/codex/guides/agents-md
- OpenAI prompt caching docs: https://platform.openai.com/docs/guides/prompt-caching

## Recommendation

Do not start with lossy prompt compression. Start with measurement, deterministic slimming, and tool-output sandboxing.

Recommended sequence:

1. Build a `context-budget`/telemetry layer that makes startup context, first-turn input, tool-output tokens, and cache behavior visible per workflow and agent.
2. Add compact/standard/verbose rendering for Aigon command templates and split `aigon/AGENTS.md` + `docs/architecture.md` into a small always-on core plus on-demand context packs.
3. Pilot RTK and context-mode behind explicit config. RTK is best for shell/test/log compression; context-mode is best for indexed large output and retrieval. Measure both against the same Aigon benchmark tasks.
4. Add a Pro Insights view for token/context outliers and suggested fixes.
5. Keep Caveman-style terse output as a user-level preference only, and reserve LLMLingua-style compression for offline summaries, never hard requirements or safety-critical launch context.

Expected impact:

- Slimming always-on docs/templates should reduce every session's initial prompt footprint, especially for Codex/OpenCode/Kimi where templates are inlined.
- RTK/context-mode can reduce noisy tool-output context by 60-98% on the surfaces they cover, but actual end-to-end savings will be lower because model reasoning, specs, source reads, and repeated sessions still dominate.
- Fleet mode remains roughly linear in context because each agent receives its own session. The right mitigation is to make each session slimmer and use Fleet only when the second/third opinion is worth it.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| context-budget-telemetry | Capture and report startup context, first-turn input, tool-output, cache, and per-phase token buckets for each Aigon workflow session. | high | none |
| context-budget-insights | Add Pro dashboard cards and outlier recommendations for high context-load sessions, noisy commands, weak cache reuse, and Fleet cost multipliers. | high | context-budget-telemetry |
| compact-template-rendering | Add `compact`, `standard`, and `verbose` command-template rendering modes, defaulting non-slash agents to compact hot-path prompts. | high | context-budget-telemetry |
| lazy-context-packs | Split large always-on Aigon instructions and architecture docs into a small core plus on-demand context packs referenced by command templates. | high | compact-template-rendering |
| agent-output-compression-pilot | Add opt-in RTK/context-mode adapters with allowlisted command categories, raw-output recovery, and benchmark comparison. | medium | context-budget-telemetry |
| pre-agent-context-hook | Add a structured pre-agent-start hook that can measure, lint, or transform optional prompt sections before launching an agent. | medium | compact-template-rendering |
| command-output-budget-lints | Warn when Aigon commands print unusually large agent-visible output and suggest compact flags or indexed retrieval. | medium | context-budget-telemetry |
| context-compression-benchmark-suite | Create representative Aigon tasks that compare full, compact, RTK, and context-mode runs for token savings and task-quality regressions. | medium | agent-output-compression-pilot |
| memory-and-instruction-prune | Detect duplicate/stale `AGENTS.md`, `CLAUDE.md`, `.aigon/docs`, and memory entries and recommend safe moves to on-demand docs. | low | context-budget-telemetry |
| compact-response-style | Add an optional per-agent terse-response preference for low-stakes status/chat output without changing specs, findings, or review prose. | low | none |
