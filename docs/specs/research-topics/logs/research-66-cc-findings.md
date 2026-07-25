# Research Findings: reduce token usage

**Agent:** Claude (cc)
**Research ID:** 26
**Date:** 2026-05-08

---

## Key Findings

### 1. Aigon's actual per-session token footprint is small — but the on-demand cost is real

I measured the hot path empirically rather than guessing.

**SessionStart hooks (every session):**

| Hook | Bytes | Approx tokens | Notes |
|---|---|---|---|
| `aigon check-version` | ~50 (hot path) | ~15 | Currently silent unless drift; cold path can reach ~1.5K tokens |
| `aigon project-context` | 221 | ~55 | Already minimal — six lines of pointers, no inlined docs |
| **Total injected by Aigon hooks** | **~270 bytes** | **~70 tokens** | **Already near-optimal** |

**CLAUDE.md auto-loaded by Claude Code (every session):**

The agent instruction file at `.aigon/docs/agents/CLAUDE.md` (a copy of `.aigon/docs/agents/claude.md`, 7,622 bytes / 144 lines) is **auto-loaded by Claude Code itself** as a project memory file. I confirmed this in the SessionStart system reminder of this very session — the entire file was injected verbatim.

- Approx 1,900 tokens per session
- Anthropic guidance ([Memory docs](https://code.claude.com/docs/en/memory)) recommends ≤200 lines for adherence; we're at 144 — fine for adherence, but the *content* is dense workflow how-to that rarely changes per turn.
- Of those 144 lines, only ~30 are universal rules; the rest are command tables and step-by-step Drive/Fleet workflows that would be better fetched on demand.

**On-demand command bodies (per invocation):**

| Command file | Bytes | Tokens (est) |
|---|---|---|
| `afd.md` (feature-do) | 10,756 | ~2,700 |
| `are.md` (research-eval) | 9,696 | ~2,400 |
| `afr.md` (feature-code-review) | 9,328 | ~2,300 |
| `afcl.md` (feature-close) | 9,201 | ~2,300 |
| Avg of 73 command files | 3,664 | ~900 |

These are **not** loaded per session — they're injected only when the slash command fires. But every workflow command burns 2-3K tokens of instructions on top of the actual task. This adds up over a Fleet run (5-10 commands × 2-3K = 15-30K tokens just on workflow scaffolding).

**Workflow state files** (`.aigon/workflows/features/{id}/snapshot.json` etc.) are **not** auto-loaded — only read when the user invokes a command. ✅

**Aigon agent instruction files for non-active agents** (`codex.md` 7.8K, `gemini.md` 10.4K, `kimi.md` 7.0K, `cursor.md` 7.4K) are present in `.aigon/docs/agents/` but only the active agent's `CLAUDE.md` symlink/copy is auto-loaded. ✅

### 2. Telemetry is already capturing per-session token cost — and it is dark

`aigon capture-session-telemetry` (the SessionEnd hook) writes per-session JSON to `.aigon/telemetry/*.json` containing **full per-turn token breakdowns**:

```json
"tokenUsage": {
  "input": 27,
  "output": 2896,
  "cacheReadInput": 349750,
  "cacheCreationInput": 66214,
  "total": 418887,
  "billable": 2923
}
```

27 telemetry files exist (152KB) covering recent feature/research runs. None of this is surfaced anywhere — not in the dashboard, not in `aigon stats`, not in any user-facing summary. **This is the single largest "free win" finding of the research:** the data to measure token cost per feature, per agent, per session is already on disk. We are flying blind despite having the instruments.

### 3. The three OSS tools called out in the spec

I had a subagent fetch and analyse the actual repos. Critical distillation:

#### RTK (https://github.com/rtk-ai/rtk) — Apache-2.0
- **What it is:** A Rust CLI that wraps `Bash` tool calls (via the `PreToolUse` hook) and **deterministically compresses common-CLI output** (`git`, `cargo test`, `pytest`, `kubectl`, `npm`). Strips banners, dedupes errors, summarizes file lists.
- **Claimed reduction:** 60-90% on wrapped commands, ~80% per session.
- **Quality eval:** None. Counts tokens, not task success.
- **Critical gap for Aigon:** Only intercepts `Bash`. Aigon agents do most of their I/O through `Read`, `Grep`, `Glob` — RTK doesn't touch those. Bash savings are real but narrow (mostly the test step).
- **Verdict:** Low-risk modest-upside add-on. Trivial install (`rtk init -g`). Possibly worth piloting per-developer; not a strategic Aigon investment.

#### Caveman (https://github.com/juliusbrussee/caveman) — MIT
- **What it is:** A Claude Code "Skill" that injects a system-prompt instructing the model to **emit telegraphic output** ("why use many token when few token do trick"), plus an offline `caveman-compress` that rewrites memory files into pidgin form.
- **Claimed reduction:** 65-75% output, 46% on file compression. Cites a March 2026 preprint claiming brevity *improves* accuracy on some benchmarks (uncorroborated).
- **Critical mismatch with Aigon:** Aigon's entire architecture leans on **rich, readable, document-driven artifacts** — feature specs, implementation logs, code review notes, research findings. These are written by one agent and consumed by another (or by the human). Compressing the *output* into caveman-speak corrupts every downstream input. The reviewer agent reads the spec; the eval agent reads three findings files; you read the log.
- **Verdict:** **Bad fit for the speech mode**. The offline `caveman-compress` on stable static memory might be okay, but the marquee feature is anti-pattern for our document-driven workflow. Skip.

#### context-mode (https://github.com/mksglu/context-mode) — Elastic License 2.0
- **What it is:** The most architecturally serious of the three. An **MCP server + multi-hook adapter** that:
  - Sandboxes tool execution so raw stdout never enters context (Playwright, log-dumps, `gh issue list` etc.)
  - Indexes >5KB outputs into a SQLite FTS5 KB and returns intent-ranked snippets
  - On `PreCompact`, emits a ≤2KB priority-tiered XML state snapshot
  - On `SessionStart`, restores via a 15-category "Session Guide"
- **Claimed reduction:** Per-scenario savings up to 99% on Playwright, 98% on GitHub issues, ~98% full session compression.
- **Critical issues for Aigon:**
  1. **Elastic 2.0 license** — fine for personal use, problematic if Aigon ever ships as managed SaaS that bundles it.
  2. **State overlap** — its session-continuity SQLite duplicates the role of our own `.aigon/workflows/features/<id>/` state. Two sources of truth means two ways to drift.
- **Verdict:** Most credible candidate; ideas worth stealing (especially the PreCompact snapshot pattern and tool-output indexing); don't adopt wholesale.

### 4. Mainstream prompt-compression worth knowing

- **Microsoft LLMLingua-2** (https://github.com/microsoft/LLMLingua, MIT, ~6.2k stars, ACL'24) — A BERT-class encoder distilled from GPT-4, 3-6× faster than v1, **20× compression** with minimal task degradation on summarization/QA. Right tool for *long static inputs* (research specs, retrieved docs). Doesn't drop into Claude Code natively — would need an MCP wrapper or hook.
- **Selective Context** (https://github.com/liyucheng09/Selective_Context) — Earlier self-information-based pruner; conceptual ancestor; LLMLingua-2 supersedes for production use.
- **Anthropic prompt caching** — orthogonal to all of the above and almost certainly the biggest single win available. See next section.

### 5. The largest single lever is already shipped: Anthropic prompt caching

Source: [docs.anthropic.com/en/docs/build-with-claude/prompt-caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)

- Cache **read tokens cost 0.1× base input** — a 90% discount on repeated prefixes
- 5-min default TTL, 1-hour extended TTL via `cache_control.ttl: "1h"`
- 4,096 token minimum on Opus 4.5+/Sonnet 4.6+/Haiku 4.5
- **Claude Code already caches the system prompt, tool schemas, and CLAUDE.md automatically** — so most of our 1,900-token agent instructions is *already* discounted in steady-state
- The leverage Aigon doesn't yet capture is on **subagents and external API calls** Aigon makes. Any custom Aigon code calling the Anthropic SDK should mark stable prefixes with `cache_control` and place mutable per-request data after the breakpoint.

The implication for our research: token *count* reduction (compression) yields ~10× less savings per token than placement of caching breakpoints. Cache before you compress.

### 6. Skills are a token-shaped redesign, not just a feature

Source: [docs / Agent Skills](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)

Skills implement **progressive disclosure** at three levels:

| Level | When loaded | Cost |
|---|---|---|
| Metadata (YAML name + description) | Always at startup | **~100 tokens / skill** |
| `SKILL.md` body | On trigger via bash | <5K tokens |
| Bundled files | On demand | unlimited |

Aigon already publishes its commands as Skills (I see `aigon:feature-do`, `aigon:research-do`, etc. in the available-skills list). What we *don't* yet do: move the **how-to-do-the-workflow content currently in CLAUDE.md** into Skills. That CLAUDE.md content is ~1,400 tokens of always-loaded explanation that's only relevant when actually running a workflow command. ~100 tokens of frontmatter would buy the same depth on demand.

### 7. Subagent token economics

Source: [Subagents docs](https://code.claude.com/docs/en/sub-agents)

Subagents are **explicitly framed by Anthropic as context-preservation**, not context-duplication. Each subagent runs in its own context window with a custom (often slim) system prompt and returns only its summary to the parent. Anthropic's official docs include the line "control costs by routing tasks to faster, cheaper models like **Haiku**".

Aigon's Fleet mode currently spawns one full-context agent per worktree. Internal exploration / grep / spec-reading inside each Fleet agent could route to **Explore** (Haiku-backed, read-only, built-in) for ~15× cost reduction on those steps. The agent CLI already supports it; we don't surface it as guidance in our agent instructions.

### 8. Hooks for context shaping (what we can and can't do)

Source: [Hooks reference](https://code.claude.com/docs/en/hooks)

- **Inject:** `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse` can all add context via `additionalContext`.
- **Strip / compress existing transcript:** No documented hook. Once tokens are in the transcript, only **compaction** (auto at ~83.5%, manual `/compact`) reduces them.
- **PreCompact** can run before compaction but cannot rewrite the transcript content — only tag/trace.

Practical implication: Aigon's lever is **what gets loaded**, not **what gets stripped**. The right move is lazy-loading via `UserPromptSubmit` (e.g. only inject feature spec when the user references the feature ID), not post-hoc compression.

### 9. CLAUDE.md content audit

Looking at the 144-line `.aigon/docs/agents/claude.md`:

- ~20 lines (~14%): universally-needed rules, modes, identity
- ~50 lines (~35%): command tables (Feature / Research / Feedback / Utility) — useful as a reference but rarely needed every turn; could be a Skill
- ~50 lines (~35%): step-by-step Drive/Fleet workflows for both feature and research — only needed when actually starting work; clear Skill candidate
- ~24 lines (~17%): "Saving Permissions" + "Before Completing a Feature" — corner cases; should be Skills

A trimmed always-loaded core could plausibly fit in **30-50 lines / ~400-500 tokens** (a 70-75% reduction on the per-session CLAUDE.md cost).

### 10. Existing config surface for compression: zero

`grep -ri 'verbosity\|compact\|slim\|terse' lib/` returns nothing. There is no `.aigon/config.json` knob today for instruction verbosity. **Greenfield.**

---

## Sources

### Primary (Anthropic)
- [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
- [Subagents](https://code.claude.com/docs/en/sub-agents)
- [Memory / CLAUDE.md](https://code.claude.com/docs/en/memory)
- [Hooks reference](https://code.claude.com/docs/en/hooks)
- [Context window](https://code.claude.com/docs/en/context-window)
- [Compaction API beta](https://platform.claude.com/docs/en/build-with-claude/compaction)
- [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)

### Tools surveyed
- [rtk-ai/rtk](https://github.com/rtk-ai/rtk) (Apache-2.0)
- [JuliusBrussee/caveman](https://github.com/juliusbrussee/caveman) (MIT)
- [mksglu/context-mode](https://github.com/mksglu/context-mode) (Elastic 2.0)
- [microsoft/LLMLingua](https://github.com/microsoft/LLMLingua) (MIT)
- [liyucheng09/Selective_Context](https://github.com/liyucheng09/Selective_Context) (MIT)

### Aigon source citations
- `.claude/settings.json:59-101` — SessionStart/SessionEnd/Stop hook config
- `node_modules/@senlabsai/aigon/lib/commands/setup.js:1571-1585` — `project-context` implementation
- `node_modules/@senlabsai/aigon/lib/commands/setup.js:1134-1230` — `check-version` implementation
- `node_modules/@senlabsai/aigon/lib/commands/misc.js:1236-1265` — `capture-session-telemetry` implementation
- `node_modules/@senlabsai/aigon/lib/backup.js:144-150` — telemetry retention defaults
- `.aigon/docs/agents/claude.md` (144 lines, 7,622 bytes) — the auto-loaded CLAUDE.md
- `.aigon/telemetry/*.json` — 27 files of session-level token data (currently dark)

---

## Recommendation

**Don't adopt RTK, Caveman, or context-mode wholesale. Build a small set of Aigon-native optimisations that compose with Anthropic's caching primitives.** The leverage order, by ROI:

1. **Surface token cost in the dashboard** (data already on disk). Without this we can't measure any other change. Highest ROI per LOC of work in Aigon.

2. **Trim and split the agent CLAUDE.md.** Reduce the always-loaded `.aigon/docs/agents/claude.md` from 144 lines to a 30-50-line core; move command tables and Drive/Fleet step-by-steps into a small set of Skills (`aigon:drive-workflow`, `aigon:fleet-workflow`, `aigon:research-workflow`). Estimated saving: ~1,400 tokens/session always-on for cc, gg, and cu (Codex/Cursor have analogous files).

3. **Lazy-load feature-spec content via UserPromptSubmit.** Today, when a user runs a workflow command, the slash command body (2-3K tokens) injects every time. Wire a `UserPromptSubmit` hook that detects "feature N" mentions and injects spec-relevant context once per session, not per turn.

4. **Make agent CLI calls cache-friendly.** Audit any Aigon code that calls the Anthropic SDK directly (autopilot, eval, llm-judge if any) and ensure stable instruction prefixes are marked with `cache_control` and dynamic data lives after the breakpoint.

5. **Encourage Haiku subagent use in Fleet.** Add a one-line directive to the new slim CLAUDE.md: "Prefer the built-in Explore subagent (Haiku) for grep/file-search tasks during research and feature work." Free 15× cost reduction on the busiest steps.

6. **Optional, lower priority:** Pilot RTK for one developer's `Bash`-heavy workflows (cargo/pytest/kubectl). Skip Caveman entirely. Borrow context-mode's PreCompact-snapshot idea for the eventual Aigon-native version, don't bundle it.

7. **Do not yet add LLMLingua / runtime compression.** It's a real tool but the integration cost (MCP wrapper, Python runtime) outweighs the gain until we've done items 1-5 and can measure where tokens still hurt.

The defensive note: every optimisation has a measurable downside risk on agent quality. Item 1 (telemetry surface) lets us regression-detect the others. **Build the dashboard first; everything else is a measurable A/B from there.**

---

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| dashboard-token-cost | Surface per-session/per-feature/per-agent token cost from existing telemetry in the dashboard, with input/output/cached breakdowns | high | none |
| agent-instructions-slim-mode | Reduce `.aigon/docs/agents/{agent}.md` to a ~50-line always-loaded core; ship as a config option (`instructions_verbosity: compact \| standard`) so users can opt in | high | dashboard-token-cost |
| workflow-skills-extraction | Extract Drive/Fleet/Research step-by-step workflows from agent CLAUDE.md into dedicated `aigon:*-workflow` Skills so they only load on trigger | high | agent-instructions-slim-mode |
| feature-spec-lazy-inject | Add a `UserPromptSubmit` hook that injects active-feature-spec context only when the user references a feature ID, instead of carrying it eagerly | medium | dashboard-token-cost |
| anthropic-cache-audit | Audit every Aigon-internal Anthropic SDK call (autopilot, eval) for `cache_control` placement; add cache breakpoints on stable prefixes | medium | none |
| haiku-subagent-guidance | Add a one-line directive to agent instructions recommending the built-in Explore (Haiku) subagent for grep/search tasks; document the pattern in `.aigon/docs/agents/` | medium | agent-instructions-slim-mode |
| precompact-snapshot-hook | Add a `PreCompact` hook that emits a small priority-tiered state snapshot (active feature, last commit, open errors) so post-compact restoration is fast — pattern borrowed from context-mode | low | dashboard-token-cost |
| rtk-integration-guide | Document how to optionally enable RTK as a per-developer add-on for Bash-heavy workflows; ship a pre-tested `.claude/settings.json` snippet | low | none |
