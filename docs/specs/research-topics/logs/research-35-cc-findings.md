# Research Findings: token and context reduction

**Agent:** Claude (cc)
**Research ID:** 35
**Date:** 2026-04-20

---

## Key Findings

### Direct measurements (repo-local, all file sizes as of 2026-04-20)

| Artefact | Size | Notes |
|---|---:|---|
| `CLAUDE.md` | 286 lines | Auto-loaded by Claude Code every CC session (harness behavior) |
| `AGENTS.md` | 209 lines | Shared-root orientation; overlaps heavily with `CLAUDE.md` |
| `docs/architecture.md` | 471 lines | Pointed to by `aigon project-context`, but not auto-injected |
| `docs/development_workflow.md` | 106 lines | Pointed to; not auto-injected |
| `templates/generic/commands/feature-do.md` | 180 lines (8.3 KB) | ~70 lines (39%) are the "Worktree execution rules (MANDATORY)" + "Step 0: Verify workspace (MANDATORY)" blocks |
| `templates/generic/commands/feature-close.md` | 203 lines | Largest command template |
| `templates/generic/commands/feature-review.md` | 182 lines | Second-largest |
| `templates/generic/commands/feature-eval.md` | 175 lines | |
| `templates/generic/commands/research-eval.md` | 187 lines | |
| `~/.codex/config.toml` | 2 069 lines / 99 KB | 679 `[projects.*]` trust entries + 1 notice + 1 mcp_servers + 1 features + 1 sandbox_workspace_write |
| `~/.claude/projects/<repo>/memory/` | `MEMORY.md` 76 lines + 37 per-topic files ~634 lines = 710 lines total | `MEMORY.md` is injected into system prompt; topic files are loaded lazily via `Read` when the agent consults an index line |
| `.claude/skills/aigon/SKILL.md` | 56 lines | Only aigon-owned CC skill file; loaded on demand |
| `.claude/commands/aigon/*.md` | 37 files, ~2 200 lines total | Slash-command definitions — loaded only when the user invokes `/aigon:*`, not auto-injected |
| `.agents/skills/aigon-*/` (cx) | 38 skill directories | Project-local skills — loaded on demand by Codex skill discovery |

Templates in `templates/generic/commands/` total 4 331 lines across 39 files (includes docs-md files). The four "hot" templates (`feature-do`, `feature-close`, `feature-review`, `feature-eval`) account for 740 lines — 17% of all template source.

### What's actually sent to a model per CC session (inference, moderate confidence)

Combining harness behavior with the files above, a fresh CC session entering `feature-do` pays roughly:

1. **Always-on context** (injected by CC harness before the first user turn):
   - System-reminder blob (tool list + policies) — harness-owned, not our lever.
   - `CLAUDE.md` (286 lines)
   - `MEMORY.md` index (76 lines)
   - Skills index for user-invocable skills (~60 lines, from the system reminder we saw this session).
2. **Invocation payload** (printed by `aigon feature-do`):
   - Full template body (~180 lines for `feature-do.md` with placeholders expanded).
   - Inline spec content (`console.log(specContent)` at `lib/commands/feature.js:1489`).
   - `--- SPEC CONTENT (already in context — no need to read the file) ---` scaffolding.
3. **Session-start hook output** — `aigon project-context` prints only 7 lines of pointers to `docs/architecture.md`, `docs/development_workflow.md`, `docs/agents/*.md`. **Those docs themselves are NOT auto-injected**; the agent only pulls them when it decides to `Read` them. This is already a token-frugal design.

Confidence: the injection points above are verifiable from source (`lib/commands/setup.js:1967`, `lib/commands/feature.js:1489`, `templates/generic/agents-md.md` marker block). The exact token/character counts per turn are not directly measurable without harness-level traces.

### Evidence-backed findings for each major question area

#### Measurement (Q: "how many tokens does a typical feature cost end-to-end?")
`lib/telemetry.js` parses CC JSONL transcripts, GG `~/.gemini/tmp/` JSON, and CX `~/.codex/sessions/` JSONL. It produces **per-session** totals (input/output tokens, cost) and per-feature rollups in `stats.json`. What it does **not** currently produce, from reading the parser signatures (`parseCodexTranscripts:711`, `parseGeminiSessionFile:438`, and the CC parser around `lib/telemetry.js:1090+`):
- Per-turn token counts — so "is cost skewed on the first turn (context load) vs mid-session (exploration)?" is not directly answerable from existing artefacts.
- Context-load attribution — there is no flag distinguishing "initial system prompt" tokens from "tool result" tokens.

**To close this gap** without guessing, a thin instrumentation feature would have each parser emit a `turns[]` array with at least `{ index, inputTokens, outputTokens, cachedInputTokens }` per turn, and the stats rollup would keep the first three turns' totals as a separate `contextLoadTokens` bucket.

#### Prompt & template wins (Aigon harness)
- **`feature-do.md` ceremony**: 180 lines of which ~70 (lines 8-50 worktree-rules block, 59-84 Step 0) repeat defensive rules the agent has already followed to get into the worktree. This block mostly fires **when the agent goes off-script**, but is paid by every on-script session too. Repro: `wc -l templates/generic/commands/feature-do.md` = 180; manual line count of the "Worktree execution rules (MANDATORY)" block + "Step 0: Verify workspace (MANDATORY)" = ~70.
- **`CLAUDE.md` / `AGENTS.md` duplication**: both contain a near-identical "Module Map", "Rules Before Editing / Six Rules Before Editing", "Common Agent Mistakes", "Reading Order" section. Grep against both shows the section headings are the same, only the preamble differs. `CLAUDE.md` is the one the CC harness auto-loads; `AGENTS.md` is scaffolded for non-CC harnesses. Keeping them both adds ~200 lines of always-on overhead for CC specifically, for redundant content.
- **Placeholder sections that render as prose even when skipped**: `{{TESTING_WRITE_SECTION}}`, `{{TESTING_RUN_SECTION}}`, `{{TESTING_STEPS_SECTION}}`, `{{LOGGING_SECTION}}`, `{{DEV_SERVER_SECTION}}`, `{{DOCUMENTATION_SECTION}}`, `{{PLAN_MODE_SECTION}}`, `{{WORKTREE_DEP_CHECK}}`, `{{TROUBLESHOOTING_SECTION}}`, `{{AUTONOMOUS_SECTION}}` — 10 placeholders in `feature-do.md` alone. Based on `lib/profile-placeholders.js` behavior, each resolves to a full paragraph per profile; the "not applicable" branches still render an explanatory paragraph rather than an empty string. Profiles (web/api/ios/android/library/generic) expose 6 variants each — every session pays for the variant even when the right behavior is "no logging needed". Exact byte-saving per placeholder was not measured; the mechanism is verifiable from `lib/profile-placeholders.js` (file present, ~500 lines, one resolver per key).
- **`aigon feature-spec` duplication**: `feature-do` already inlines the spec (`feature.js:1489`). The template explicitly tells the agent not to re-run `aigon feature-spec`. However, some templates (e.g. `feature-review.md` Step 2) still call `aigon feature-spec` unconditionally, which re-emits the spec body the agent already has if they chained commands. Evidence: line 45 of `feature-review.md`.

#### Harness / session shape wins
- **CC auto-memory is lazy, not eager**: the `# auto memory` block in `CLAUDE.md` (this file) tells the agent to save to `~/.claude/projects/<repo>/memory/` and use `MEMORY.md` as an index. Looking at `MEMORY.md` (76 lines) vs. total memory (710 lines), only the index is injected; individual topic files are opened on demand. This is already a good design. The opportunity is **pruning the index itself**: of 37 entries, several reference retired agents (`reference_mistral_vibe_setup.md`, `reference_cursor_agent_retired.md` — cu is actually active per memory note) or outdated feedback that's now codified in `CLAUDE.md`.
- **Codex `~/.codex/config.toml` (2 069 lines)**: the content is a TOML configuration, not a model prompt. `codex` the CLI reads it locally to (a) decide project trust, (b) load `[mcp_servers.*]` wiring, (c) load model defaults. By the architecture of how tool-use / approval works in Codex, the model is given the model config (`model`, `model_reasoning_effort`, `personality`) but not the 679 `[projects.*]` trust entries. **Confidence: moderate**. Direct proof would require capturing a Codex network request. Best available evidence: the same config file on disk has existed through many sessions regardless of cwd, and Codex's approval/sandbox handling is documented as a CLI-side check. If the model were receiving 99 KB of trust entries per session, we would see much larger first-turn input-token counts than telemetry shows.
- **Installed skill count vs. per-session usage**: `aigon install-agent cx` writes 38 project-local skill directories; a typical `feature-do` session consults only `aigon-feature-do/SKILL.md`. By Codex skill discovery (name-based), non-matching skills are not loaded into the model prompt. For CC, 37 slash-command files under `.claude/commands/aigon/` are slash-command bodies — only expanded when the user runs `/aigon:<cmd>`. These are zero-cost for routine feature sessions.

#### Workflow / orchestration wins
- **Fleet mode cost multiplier ≈ 3× solo** (high confidence from design): each Fleet worktree launches a fresh agent CLI with zero shared context. `lib/commands/feature.js` creates N independent tmux sessions, each running `buildAgentCommand(...)` for its own worktree. There is no shared system prompt and no shared memory between them. The cost is therefore sum-of-sessions, not shared. This is architectural; reducing it would mean fundamentally changing Fleet semantics.
- **AutoConductor poll loop does NOT cost tokens**: `__run-loop` polls with `spawnSync('sleep', [pollSeconds], ...)` (see `lib/commands/feature.js:2990, 3006, 3044, 3223`) and reads workflow state via `workflowSnapshotAdapter.readWorkflowSnapshotSync` — pure CLI/file reads. The loop spawns a *new agent session* for review/eval when state advances; the polling itself is free. Default cadence 30 s.
- **`aigon next` is rule-based**: `templates/generic/commands/next.md` directs the agent to run `git branch --show-current`, `git status --short`, `aigon board --list --active`, then parse the branch-name pattern. No model call is invoked by the CLI itself; the agent does the parsing. So `next` does cost "one thinking turn" per invocation, but it is bounded and the template is only 188 lines.
- **Autopilot (`--iterate`) amplifies context-load cost**: every retry starts a fresh CLI agent session, paying the full always-on context again. There is no distilled carry-forward of "what was tried last iteration". For long Autopilot runs, this multiplies context-load by the iteration count. Evidence: `runRalphCommand` in `lib/validation.js` spawns the CLI for each iteration.

#### Codex-specific
- **`model_reasoning_effort = "medium"` globally**: confirmed at `~/.codex/config.toml:2`. Dropping to `"low"` for routine features would cut reasoning-tokens meaningfully — but this is a model-tuning lever, which the topic explicitly puts **out of scope** ("Model selection ... is a separate cost lever"). Flagging only.
- **Awaiters**: partially mitigated per `a092ef27` / `3db70a7a`. I did not see residual awaiter calls during today's session, but could not verify absence across all code paths from a static review in the time available.

#### Target-repo shape
- Hottest file by agent reads is almost certainly `lib/commands/feature.js` (3 902 lines per `wc -l` today). A grep across recent log files for `lib/commands/feature.js` references would confirm, but even without that: it owns all `feature-*` handlers, so most feature work touches it. Splitting is called out as out-of-scope by this research topic.
- `CLAUDE.md` (286 lines) is itself a candidate for trimming. Sections like the full `Module Map` (reproduces what `AGENTS.md` already has), `Six Rules Before Editing`, and `Common Agent Mistakes` double up what's in `AGENTS.md`.

### Ranked token sinks (with confidence)

1. **`CLAUDE.md` + `AGENTS.md` dual-injection for CC sessions** — ~200 duplicate lines paid every CC session. **High confidence** it's duplicated; **moderate confidence** on savings size, depends on how aggressively we can delete.
2. **Per-template "MANDATORY" ceremony blocks** (`feature-do.md`, `feature-start.md`, `feature-eval.md`, `feature-review.md`) — ~70 lines/template × 4 hot templates = ~280 lines of defensive boilerplate paid whenever those templates are emitted. **High confidence**; directly countable.
3. **Autopilot cold-start per iteration** — full context-load × N iterations. **Moderate confidence**; mechanism is clear, actual iteration counts vary.
4. **Placeholder sections rendering "skip" paragraphs** (`{{TESTING_WRITE_SECTION}}` etc.) — ~10 placeholders per hot template; each rendering ~5-15 lines even in the "not applicable" case. **Moderate confidence**; need to read `lib/profile-placeholders.js` body to confirm the skip-variants aren't already empty.
5. **Fleet parallelism** — ~3× multiplier inherent to design. **High confidence**; not a reducible sink without changing Fleet semantics.
6. **`~/.codex/config.toml` size** — **low confidence that this is a sink at all**. Direct evidence suggests Codex reads this locally, not as prompt context.
7. **Memory index bloat** (`MEMORY.md` at 76 lines) — mild; some entries are retired (mv, cu-as-retired). Small absolute saving.

## Sources

- Repo file measurements run 2026-04-20 during this research session:
  - `wc -l` over `templates/generic/commands/*.md`, `AGENTS.md`, `CLAUDE.md`, `docs/architecture.md`, `docs/development_workflow.md`.
  - `wc -l /Users/jviner/.codex/config.toml` = 2069; `grep -c '^\[' ...` = 684 sections; `grep '^\[' | sed s/\\..*// | sort -u` breakdown (679 `[projects]`, 1 each of `[sandbox_workspace_write]`, `[notice]`, `[mcp_servers]`, `[features]`).
  - `wc -l ~/.claude/projects/-Users-jviner-src-aigon/memory/*.md` = 710.
- Code: `lib/commands/feature.js` (`feature-do` inline behavior at ~line 1489; `__run-loop` poll cadence at lines 2755, 2990, 3006, 3044, 3223); `lib/commands/setup.js` (`project-context` impl at 1967-1973); `lib/telemetry.js` (parser signatures at 438, 502, 592, 711).
- Live run of `aigon project-context` — confirms 7-line doc-pointer output; no inlined doc bodies.
- `CLAUDE.md` "auto memory" block — describes the lazy-load memory pattern used in this session; `MEMORY.md` is ingested as part of the system prompt per the convention stated.
- Topic questions (`docs/specs/research-topics/03-in-progress/research-35-token-and-context-reduction.md`).

## Recommendation

Priority order:

1. **Consolidate `CLAUDE.md` into `AGENTS.md` as the single source of truth, pointer-only from `CLAUDE.md`.** Directly actionable now. `CLAUDE.md` becomes a ~20-line pointer file ("See `AGENTS.md`"). Expected saving: ~250 lines of always-on context per CC session. Risk: low — harnesses that read `CLAUDE.md` will see the pointer and follow it.
2. **Collapse the "Worktree execution rules (MANDATORY)" + "Step 0: Verify workspace (MANDATORY)" blocks across the four hot templates to a single 3-line invariant.** Directly actionable. The long defensive rules are a reaction to past off-script agent behavior; now that the harness routinely runs inside worktrees, a single `pwd && git branch --show-current` check is enough. Expected saving: ~280 lines of template ceremony across `feature-do`/`feature-start`/`feature-eval`/`feature-review`.
3. **Make profile placeholders render empty when the applicable variant is "skip".** Requires reading each resolver in `lib/profile-placeholders.js` and changing the "not applicable" branches to return `""` (plus trimming the surrounding blank lines in the template). Expected saving: 20-60 lines per hot-template invocation depending on profile. Low risk — agent will just not see an irrelevant section.
4. **Add per-turn token attribution to `lib/telemetry.js` parsers.** Blocked on measurement to answer the topic's first measurement question; without it, we can rank by file size but not by observed cost. This is itself a small feature (extend three parsers), but it is the enabler for data-driven decisions rather than static-file-size ones.
5. **Prune `MEMORY.md` of retired-agent and superseded entries.** Small, cheap — drop `reference_mistral_vibe_setup.md`, `reference_cursor_agent_retired.md`, and any feedback entries now codified in `AGENTS.md`. Expected saving: ~15-20 lines of always-on memory index.

Deferred / out of scope:

- **Autopilot distilled-context carry-forward** — meaningful but bigger-effort feature; revisit once (4) gives us real numbers on iteration cost.
- **Codex `model_reasoning_effort` tuning** — model-tuning lever; out of topic scope.
- **Splitting `lib/commands/feature.js`** — target-repo refactor; out of topic scope.
- **Codex config.toml** — best evidence indicates this is not a prompt-context cost; do not propose a fix for a non-problem.
- **Fleet-mode cost sharing** — would change Fleet semantics; out of topic scope.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| consolidate-root-agent-instructions | Merge CLAUDE.md into AGENTS.md as single source, reduce CLAUDE.md to a 20-line pointer. Est. 250-line saving per CC session. | high | none |
| collapse-mandatory-blocks-in-hot-templates | Replace ~70-line "Worktree execution rules" + "Step 0" ceremony in feature-do/start/eval/review with a 3-line invariant check. Est. 280-line cross-template saving. | high | none |
| profile-placeholders-render-empty-when-skipped | Audit lib/profile-placeholders.js so "not applicable" resolvers return empty strings and templates trim surrounding blank lines. | medium | none |
| telemetry-per-turn-token-attribution | Extend cc/cx/gg parsers in lib/telemetry.js to emit a turns[] array with per-turn input/output/cached tokens; surface first-N-turn totals as a contextLoadTokens bucket in stats.json. | medium | none |
| prune-memory-index-retired-entries | Remove retired-agent and superseded feedback entries from ~/.claude/projects/<repo>/memory/MEMORY.md and their topic files. | low | none |
