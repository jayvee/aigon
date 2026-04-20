# Research Findings: token and context reduction

**Agent:** Codex (cx)
**Research ID:** 35
**Date:** 2026-04-20

---

## Key Findings

### Executive summary

The biggest Aigon-controlled wins are straightforward:

1. Cut always-loaded instruction mass in `AGENTS.md`, `CLAUDE.md`, and long command templates.
2. Remove repeated ceremony from `feature-do` and related prompts, especially workspace/worktree checks and profile placeholder blocks.
3. Stop duplicating spec/context delivery paths where the harness already injected the same content inline.
4. Add better telemetry for activity phase and agent/provider parity before making strong claims about eval/review/close or Fleet-vs-solo economics.
5. For Claude specifically, lean on prompt caching intentionally; for Codex specifically, focus on reducing cold-start prompt size because cx is the current outlier in observed telemetry.

### Ranked token sinks

| Rank | Sink | Evidence | Confidence | Why it matters |
|------|------|----------|------------|----------------|
| 1 | Root always-on docs are large | `AGENTS.md` 210 lines / 1,913 words; `CLAUDE.md` 287 lines / 3,285 words; `docs/architecture.md` 472 lines / 4,165 words | high | These are static instructions that get re-read across sessions. |
| 2 | `feature-do` is mostly ceremony before implementation | `templates/generic/commands/feature-do.md` is 181 lines / 1,279 words; worktree rules are 301 words; Step 0 is 168 words; testing/logging placeholders add ~277 words when enabled | high | A large fraction of the launch prompt is reusable policy, not feature-specific work. |
| 3 | Claude startup context is huge but mostly cache-read | Recent cc logs average ~1,246 input, ~32,589 output, ~370,534 cache-create, ~11,988,206 cache-read tokens | high | Stable prompt mass exists today; prompt caching is already masking some of the billable pain. |
| 4 | Codex implementation sessions are much larger than Claude in current telemetry | Recent cx logs average ~5,568,079 input, ~26,721 output, ~5,273,080 cache-read, ~10,877,176 total vs cc ~12,392,575 total dominated by cache-read | medium | Even allowing for telemetry/provider differences, cx is the current outlier. |
| 5 | Hot files are oversized and repeatedly touched | `lib/commands/feature.js` 3,903 lines; `lib/dashboard-server.js` 1,854; `lib/worktree.js` 1,500; `templates/dashboard/js/pipeline.js` 1,073 | high | Large "obvious" files attract broad reads during implementation and review. |
| 6 | AutoConductor polling itself is cheap; session restarts are not | `feature-autonomous-start __run-loop` polls local snapshots + tmux state and sleeps; it does not call an LLM on each 30s tick | high | The token cost is from spawned agent sessions, not the poll loop. |

### Detailed findings

#### 1. Always-on repo context is too large for its role

- `AGENTS.md`, `CLAUDE.md`, and `docs/architecture.md` together are about 9,363 words in this repo.
- Claude's docs explicitly say `CLAUDE.md` files load at session start, should target under 200 lines, and that skills are better for task-specific workflows and reference material.
- In this repo, `CLAUDE.md` is 287 lines and `AGENTS.md` is used as shared orientation. That means orientation, workflow policy, architecture notes, and edge-case rules are competing for startup context every time.
- Cross-repo sample suggests this repo is the outlier. `aigon-pro` has a 76-line `AGENTS.md`; `farline` has 25-line `AGENTS.md` and 37-line `CLAUDE.md`; `jvbot` has 33/34. Aigon's own root docs are materially heavier than the target repos it orchestrates.

Implication: the biggest Aigon-specific startup reduction is to demote reference material from root docs into on-demand skills/rules and leave only the minimum always-on policy in root files.

#### 2. `feature-do` carries too much repeated policy

- `feature-do.md` is 1,279 words.
- The "Worktree execution rules" block alone is 301 words.
- Step 0 workspace verification is another 168 words.
- The testing/logging placeholders in production mode add about 277 words more:
  - `FULL_WRITE_SECTION`: 122 words
  - `FULL_RUN_SECTION`: 46 words
  - `FULL_LOGGING`: 109 words
- That means roughly 746 words of `feature-do` are fixed ceremony before feature-specific content, even before profile-specific sections like dev-server guidance.

Options considered:

- Keep current prompt and rely on model obedience.
  - Pro: safest against workspace mistakes.
  - Con: repays the same 400-700 word policy tax every session.
- Collapse policy into a short invariant block and move detail into skills/docs.
  - Pro: biggest direct token win under Aigon control.
  - Con: needs careful wording so safety doesn't regress.
- Rely purely on CLI enforcement.
  - Pro: smallest prompts.
  - Con: some safeguards are still prompt-only today.

Recommendation: keep one short mandatory invariant block in `feature-do`, then move the long failure-mode examples to an on-demand troubleshooting skill or docs link.

#### 3. Aigon duplicates context delivery paths

- `feature-do.md` says: "The spec body was printed inline by the `feature-do` command above. Use that inline copy. Do not re-read the spec from disk."
- The same template also includes a fallback `aigon feature-spec <ID>` path, and the wider docs repeatedly teach "resolve the spec via `feature-spec`."
- `worktree.js` shows that cx launches inline the full markdown body of the canonical template via a temp file. That means cx already receives a large launch prompt body before any follow-up file reads.
- `aigon board` currently emits 124 lines in this repo. This is not catastrophic, but it is too verbose to be a routine "re-orient me" step if the agent already knows the active entity.

Inference: the current workflow still teaches agents to reacquire context that the harness often already supplied. The harness is spending tokens to say "trust the inline copy" because the workflow otherwise encourages distrust.

#### 4. Claude's current token pattern says "cache the prefix harder," not "shrink output only"

- Recent cc logs in `docs/specs/features/logs/*.md` show small uncached input and very large cache numbers.
- Average from sampled recent cc logs:
  - input: ~1,246
  - output: ~32,589
  - cache creation: ~370,534
  - cache read: ~11,988,206
- Anthropic's prompt caching docs say the cached prefix covers `tools`, `system`, and `messages` up to the cache breakpoint, and that `total_input_tokens = cache_read_input_tokens + cache_creation_input_tokens + input_tokens`.

Options considered:

- Shrink root prompt only.
  - Pro: simpler.
  - Con: leaves easy caching leverage unused.
- Add explicit prompt-caching around stable Aigon startup context.
  - Pro: matches Anthropic's documented best practice for stable reusable prefixes.
  - Con: provider-specific; only helps Claude-family flows.

Recommendation: do both, in order. First reduce prompt mass. Then make the remaining stable prefix explicitly cacheable.

#### 5. Codex is the current outlier, and the likely cause is cold-start prompt size plus repeated restarts

- `.codex/config.toml` is 2,069 lines and contains 679 `[projects."..."]` trust sections.
- The first lines are configuration/trust metadata, not prompt prose. I could not find official OpenAI documentation saying this file is serialized into model prompt context. Current evidence is stronger for "Codex reads it locally as configuration" than for "the model sees all 2,069 lines."
- By contrast, we do have direct repo evidence that Aigon inlines large cx prompt bodies from `templates/generic/commands/*.md` at launch (`lib/worktree.js`, `lib/agent-prompt-resolver.js`).
- Recent cx telemetry is materially larger than cc telemetry in this repo. For the 13 features where both cc and cx recorded billable tokens, the median cx/cc ratio is about 398x. That number is too extreme to treat as a pure apples-to-apples quality comparison, but it is still a strong signal that cx sessions are where startup waste is showing up most clearly right now.

Conclusion: treat `.codex/config.toml` prompt-cost as unproven, but treat cx cold-start prompt mass and repeated re-launching as proven enough to optimize now.

#### 6. Installed skills are not the main Claude startup problem

- In this repo, `.claude/skills/` contains 1 project skill file: `.claude/skills/aigon/SKILL.md`.
- Claude's docs say skills load descriptions at start and full content on demand, while `CLAUDE.md` loads every session.
- For Codex in this repo, `.agents/skills/` contains 38 skill directories. In this Codex session, the available-skill list is surfaced to the model, but Aigon also bypasses skill discovery for cx feature launches by inlining the canonical command body.

Implication: for Claude, root instructions are the bigger startup tax than installed skill bodies. For Codex, the inline launch body matters more than the existence of skill files on disk.

#### 7. Auto memory can become noisy, but Claude's current docs cap startup load

- On this machine, some Claude project memory directories are large (`~/.claude/projects/-Users-jviner-src-aigon/memory` has 38 files; `jvbot` has 25; `farline` has 15).
- Anthropic's docs say only the first 200 lines or 25KB of `MEMORY.md` loads at conversation start; topic files are read on demand.

Conclusion: auto memory is worth pruning for correctness/noise, but it is not the first startup token fire compared to oversized root docs and prompts.

#### 8. Current telemetry is not enough to answer all "typical feature cost" questions cleanly

What current data can answer:

- cx is the most expensive observed implementation agent in this repo's recent data.
- cc prompt usage is dominated by cache-read and cache-write tokens.
- The telemetry corpus is overwhelmingly `implement` activity:
  - `cx:implement` 94 sessions / 183,433,840 billable tokens
  - `cc:implement` 54 sessions / 1,479,176 billable tokens

What current data cannot answer confidently:

- Clean end-to-end feature cost split across implement vs review vs eval vs close
- A trustworthy Fleet-vs-solo multiplier
- gg costs in practice
- Whether the user's Claude Code 5-hour usage window counts cache-read the same way as API usage fields

Missing fields / gaps:

- Normalized telemetry coverage for all activities, not just `implement`
- Better per-session provider parity for cx / gg / cu
- A durable "workflow run id" linking implement, review, eval, and close sessions
- Explicit startup vs mid-session segmentation

#### 9. The most-read files are also the largest files

Using recent git-history churn as a proxy for hot read paths:

- In `aigon`, the hottest files are:
  - `lib/dashboard-server.js` (120 recent touches, 1,854 lines)
  - `lib/commands/feature.js` (118 touches, 3,903 lines)
  - `lib/worktree.js` (68 touches, 1,500 lines)
  - `lib/commands/setup.js` (68 touches, 3,696 lines)
  - `CLAUDE.md` (54 touches, 287 lines)
  - `docs/architecture.md` (51 touches, 472 lines)
- In `jvbot`, `src/index.ts` and `src/shared/config.ts` are hot and `src/shared/config.ts` is already 476 lines.
- In `farline`, `src/components/marketing/HomepageSections.tsx` is hot and 768 lines.

Implication: target-repo refactors are a medium-effort win, not the first win. But the data does support follow-up work to split the hottest oversized files so agents don't need to ingest the whole module to answer a narrow question.

## Sources

- Local repo inspection:
  - `templates/generic/commands/feature-do.md`
  - `templates/generic/commands/feature-start.md`
  - `templates/generic/commands/feature-eval.md`
  - `templates/generic/commands/feature-review.md`
  - `templates/generic/commands/research-do.md`
  - `lib/worktree.js`
  - `lib/agent-prompt-resolver.js`
  - `lib/profile-placeholders.js`
  - `lib/telemetry.js`
  - `lib/commands/feature.js`
  - `lib/templates.js`
  - `AGENTS.md`
  - `CLAUDE.md`
  - `docs/architecture.md`
  - `.aigon/telemetry/*.json`
  - `docs/specs/features/logs/*.md`
- Anthropic:
  - Claude memory docs: https://code.claude.com/docs/en/memory
  - Claude features overview: https://code.claude.com/docs/en/features-overview
  - Claude skills docs: https://code.claude.com/docs/en/skills
  - Claude prompt caching docs: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- OpenAI:
  - GPT-5.4 model page: https://developers.openai.com/api/docs/models/gpt-5.4
  - GPT-5.2-Codex model page: https://developers.openai.com/api/docs/models/gpt-5.2-codex
  - GPT-5.3-Codex model page: https://developers.openai.com/api/docs/models/gpt-5.3-codex

## Recommendation

Implementation order:

1. Shrink the always-on prompt surface now.
   - Action: trim `AGENTS.md` / `CLAUDE.md` / long command templates to startup-critical rules only.
   - Why first: highest-confidence Aigon-controlled win.
   - Status: directly actionable.

2. Refactor `feature-do` into a short invariant block plus on-demand detail.
   - Action: collapse duplicated workspace/worktree/test/logging ceremony; keep one short mandatory safety block.
   - Why second: it affects nearly every implementation session.
   - Status: directly actionable.

3. Stop duplicate context delivery.
   - Action: remove redundant spec lookup and other re-orientation output when the harness already supplied it inline.
   - Why third: smaller win than root prompt trimming, but easy and compounding.
   - Status: directly actionable.

4. Add telemetry coverage for non-implement activities before optimizing eval/review economics.
   - Action: record normalized activity for review/evaluate/close and link related sessions under one workflow run.
   - Why fourth: closes the biggest measurement blind spot.
   - Status: blocked on follow-up instrumentation feature.

5. Add provider-specific optimizations after the common prompt mass is smaller.
   - Claude: explicit prompt-caching around the stable prefix.
   - Codex: reduce inline launch-body size and avoid unnecessary fresh sessions.
   - Status: partly actionable now, partly vendor-sensitive.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| slim-root-agent-context | Reduce `AGENTS.md` and `CLAUDE.md` to startup-critical guidance and move reference/workflow detail into on-demand skills or scoped rules. | high | none |
| compress-feature-do-template | Rewrite `feature-do` to keep one short mandatory safety block while removing repeated ceremony and large placeholder sections from the default launch body. | high | none |
| eliminate-duplicate-spec-context | Stop printing or instructing redundant spec/context retrieval when the harness already injected the same content inline. | high | compress-feature-do-template |
| activity-complete-session-telemetry | Extend normalized telemetry so implement, review, eval, and close sessions are all attributed consistently under one workflow run. | high | none |
| claude-prompt-cache-stable-prefix | Introduce explicit prompt-caching for Claude sessions around the stable Aigon startup prefix after prompt mass has been trimmed. | medium | slim-root-agent-context |
| split-hottest-oversized-modules | Break up the hottest oversized modules and docs so agents can load narrower slices during implementation and review. | medium | none |
