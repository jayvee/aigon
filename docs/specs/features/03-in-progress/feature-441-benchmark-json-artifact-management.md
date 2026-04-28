---
complexity: medium
# agent: cc    # optional — id of the agent that owns this spec. Used as the
#              #   default reviewer for spec-revise cycles when the operator
#              #   does not pick one explicitly. Precedence at revision time:
#              #     event payload nextReviewerId > frontmatter agent:
#              #     > snapshot.authorAgentId > getDefaultAgent().
# research: 44 # optional — id (or list of ids) of the research topic that
#              #   spawned this feature. Stamped automatically by `research-eval`
#              #   on features it creates. Surfaced in the dashboard research
#              #   detail panel under Agent Log → FEATURES.
# planning_context: ~/.claude/plans/your-plan.md  # optional — path(s) to plan file(s)
#              #   generated during an interactive planning session (e.g. EnterPlanMode).
#              #   Content is injected into the agent's context at feature-do time and
#              #   copied into the implementation log at feature-start for durability.
#              #   Set this whenever you ran plan mode before writing the spec.
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-28T13:47:27.157Z", actor: "cli/feature-prioritise" }
---

# Feature: benchmark-json-artifact-management

## Summary

Aigon's perf-bench results measure provider-served models (Anthropic, OpenAI, Google, OpenRouter, Kimi). The work happens on the provider's servers — not on the user's machine. Two consequences fall out of that observation:

1. **Benchmark JSONs are reproducible artifacts, not per-user data.** A run captured on the maintainer's machine against the deterministic `brewboard` seed will produce the same numbers (modulo provider variance) for any user with the same models — because nobody is "running the model locally". The right home for these files is the source repo, locked in to a release tag, like a fixture.

2. **The "runs on your machine" marketing framing is wrong.** `site/app/pro/page.tsx` currently sells benchmarks as `"Benchmarks always run on your machine, with your API keys, against your installed Aigon. The numbers reflect the experience you actually get — not someone else's network or quota."` That copy is misleading: the network/quota of the maintainer's machine matters as little as the network/quota of any user's machine — neither does the actual model inference. Until aigon supports local model providers (e.g., Ollama, LM Studio), the honest framing is *authoritative shipped benchmarks, refreshed each release*.

This feature commits to that framing and aligns the artifact policy with it: track every JSON in git, ship a fresh sweep per release, fix the public-facing copy, and add a forward-compat caveat for the day local models land.

## User Stories
- As an Aigon user evaluating which agent/model to use, I want a benchmark matrix that ships with the repo so I get authoritative numbers without paying provider costs to re-run a sweep myself.
- As an Aigon maintainer cutting a release, I want a documented "refresh benchmarks before tag" step so the shipped numbers always describe the version users install.
- As a reader of `aigon.build/pro`, I want the benchmark section to honestly describe what's being measured (provider-served model behaviour, captured on a deterministic seed) and what is *not* being measured (anything specific to my hardware), so I can trust the data and the product positioning.
- As a future user of local-model providers (when supported), I want benchmarks for those models to be clearly marked machine-dependent so I don't conflate them with the provider-served numbers.

## Acceptance Criteria

### Artifact policy
- [ ] `.aigon/benchmarks/` stays tracked in git (no new gitignore rule). Per-pair `<seed>-<feature>-<ts>.json`, aggregate `all-<seed>-*.json`, and the F438 in-place `quality:` writeback are all committed.
- [ ] A `RELEASE.md` (or addition to `CONTRIBUTING.md` § Release) documents the convention: maintainer runs `aigon perf-bench <seed> --all --judge` shortly before tagging a release; the resulting JSONs land in the release commit.
- [ ] `aigon perf-bench --help` mentions that committed runs become the shipped reference data.
- [ ] No retention/pruning CLI is added — keeping every run is the *point* (you can compare v2.61 vs v2.62 numbers from `git log`).

### Marketing copy correction (`site/app/pro/page.tsx`)
- [ ] Heading "How fast is each agent — on *your* machine?" rewritten to remove the machine framing. Suggested: "How fast is each agent — across providers and models?" (or similar; final wording at maintainer discretion).
- [ ] `"Local-first by design"` card replaced. New title + body frames the value as: *authoritative, reproducible numbers shipped with each release, captured on a deterministic seed, identical for any user calling the same provider models*. Explicit footnote / line: *if and when aigon supports local model providers, those benchmarks will be machine-dependent and will be labelled as such*.
- [ ] `"Reference baseline (planned)"` card updated — the reference baseline is no longer "planned", it's the actual shipping model. Either merge with the new authoritative-benchmarks card or rewrite to say "ships with every release".
- [ ] `"the cost you pay for the workflow engine on your hardware"` rephrased — overheadMs is measured against the bare provider call, not against the user's hardware.
- [ ] No other doc/site copy implies benchmarks are per-user (grep `site/`, `README.md`, `docs/` for "your machine", "your hardware", "locally" near "benchmark" — fix any other matches).

### Forward-compat caveat
- [ ] **As a footnote** at the bottom of the Pro page benchmark section (small text, visually subordinate to the main copy), one sentence signalling that the reproducibility claim is contingent on the model running provider-side. When local-model support arrives (Ollama, LM Studio, etc.), per-user benchmarks for those entries become machine-dependent and will be flagged accordingly. Save local-model support itself for another feature — this footnote is the only acknowledgement needed now. No engine code change required.

## Validation
```bash
node --check aigon-cli.js
git ls-files .aigon/benchmarks/ | wc -l    # >= the count before this feature
grep -ri "your machine\|your hardware" site/app/pro/page.tsx   # zero matches expected
```

## Pre-authorised
- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.
- May edit copy in `site/app/pro/page.tsx` and add a sentence to `RELEASE.md` / `CONTRIBUTING.md` without separate sign-off, provided the edits stay within the acceptance criteria above.

## Technical Approach

Two thin work streams; neither requires engine changes.

**(1) Documentation of the artifact policy.** No code edits to `lib/perf-bench.js` or the dashboard read path — current behaviour (write per-pair JSON + aggregate JSON to `.aigon/benchmarks/`, F438's in-place `quality:` writeback) is already what we want. Add a section to `CONTRIBUTING.md` (or a new `RELEASE.md`) titled "Refresh benchmarks before tagging" with the exact command and the rationale for keeping every run. Optionally add a one-line reminder in `lib/perf-bench.js`'s file-header comment.

**(2) Copy edits in `site/app/pro/page.tsx`.** Four targeted replacements at the lines identified above. The replacement should:
- Lead with *authoritative* (not *local-first*).
- Tie reproducibility to the provider-served-model fact, not to "your network / quota".
- Keep the existing "one command to refresh" card as-is — that's still accurate for users who *want* to re-run.
- Keep the "failure context, not just dashes" card — also still accurate.
- Add a footnote (small subordinate text) at the bottom of the section noting the local-model caveat — one sentence; not a top-level card, not in the heading.

Out of an abundance of caution, also grep `site/content/guides/` for "your machine"-style phrasing in agent-matrix and benchmark-adjacent guides; fix anything found.

## Dependencies
- Depends on F438 (token + judge axes) — its in-place `quality:` writeback is part of the artifact shape this spec is locking in. F438 is already done (shipped in 2.62.0).

## Out of Scope
- **Local model provider support.** The forward-compat caveat is just a sentence in the marketing copy; actually adding Ollama / LM Studio / vLLM as a provider is its own (large) feature.
- **Pro-side read changes.** OSS controls writes; Pro adapts reads. Nothing in this spec mutates the read path or the JSON schema beyond what F438 already shipped.
- **Pruning / retention CLI.** Explicitly rejected — every run is part of the historical record.
- **Cross-release benchmark comparison UI.** A "v2.61 vs v2.62" diff view in the dashboard would be useful but is a separate feature; this spec only ensures the *data* is preserved.
- **Re-publishing or backfilling old benchmark numbers.** Whatever is currently committed stays as-is; the new framing applies forward.

## Decisions (resolved during spec review)
- **Convention-only refresh, no enforcement.** The "run `aigon perf-bench --all --judge` before tag" step is documented in `RELEASE.md` / `CONTRIBUTING.md` and lived by the maintainer. No git hook, no CI gate. Rationale: maintainer-only workflow; release-to-release benchmark drift is small and predictable; a hook is overkill.
- **Local-model caveat is a footnote.** Subordinate small-text line at the bottom of the Pro benchmark section. Not a card, not in the heading, not a tooltip. Local-model provider support itself (Ollama, LM Studio, vLLM) is its own future feature; this footnote is the only forward-looking promise this feature ships.
- **No release-tagging on per-pair JSON, no cross-release diff UI.** Numbers between adjacent releases won't move enough to justify schema changes or a comparison surface. Anyone who wants v2.61-vs-v2.62 deltas can `git log` the bench dir.

## Open Questions
- _(none)_

## Related
- F438 — token-usage + LLM-judged quality axes for perf-bench (shipped 2026-04-28 in v2.62.0); locked in the JSON shape this spec preserves.
- F360 — original perf-bench harness (per `AGENTS.md` line 107).
- Marketing copy currently in `site/app/pro/page.tsx` lines 393, 412–414, 426–429, ~449.
- 2.62.0 release prep (this session) — surfaced the question.
