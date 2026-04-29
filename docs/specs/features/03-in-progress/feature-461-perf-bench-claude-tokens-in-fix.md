---
complexity: medium
set: agent-benchmarks
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-29T22:03:12.712Z", actor: "cli/feature-prioritise" }
---

# Feature: perf-bench-claude-tokens-in-fix

## Summary

The dashboard agent benchmarks matrix renders "Tokens In: 0" for every Claude (`cc`) row — Sonnet 4.6, Opus 4.7, Opus 4.7 (1M ctx), Haiku 4.5 — despite those runs billing $11–14 of input tokens. The "Tokens In" column reads `freshInputTokens` (uncached input), and for `cc` rows that field collapses to 0 because the bench writer isn't populating `cachedInputTokens` from Claude SDK telemetry. `cx` (Codex) rows render correctly because their telemetry path fills both `inputTokens` and `cachedInputTokens`. Fix the producer so new `cc` perf-bench runs write the same shape as `cx`, making "Tokens In" a meaningful comparison column across agents.

## User Stories

- [ ] As an operator comparing agents, I can sort the benchmark matrix by Tokens In and see real values for Claude rows, not zeros.
- [ ] As a Pro user evaluating cost-per-feature, I can trust that `cc` bench JSON carries the same `tokenUsage` fields as `cx` so any downstream report (cost-per-task, cache-hit ratio) works for both.

## Acceptance Criteria

- [ ] A new `aigon perf-bench brewboard cc` run for at least one Sonnet model writes a bench JSON whose `tokenUsage` block contains non-zero `inputTokens`, non-zero `cachedInputTokens`, and a derived `freshInputTokens = inputTokens − cachedInputTokens` ≥ 0.
- [ ] The dashboard "Tokens In" column shows a non-zero value for that row (manual verification via `browser_snapshot`).
- [ ] `cx` rows are unchanged — same shape, same numbers, no regressions in their bench JSON.
- [ ] No backfill of historical bench files; fix forward only. Old `cc` files keep their zero values and are not rewritten.

## Validation

```bash
node -c aigon-cli.js
npm test
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Technical Approach

The bench writer pipeline goes: `lib/telemetry.js` (per-turn token accounting) → `lib/feature-status.js` (aggregation into `tokenUsage` block) → `lib/perf-bench.js` (assembles bench JSON, calls `feature-status` aggregator). For `cx`, the Codex transcript reader populates both `inputTokens` and `cachedInputTokens`, so `freshInputTokens` math holds. For `cc`, the Claude SDK telemetry emits cache_read tokens distinctly (the `cache_read_input_tokens` field on usage events) but the per-turn aggregator either drops them or folds them into `inputTokens` without splitting.

Investigation steps:

1. Inspect `lib/telemetry.js` Claude turn-extraction path (`turnInput` accumulation around line 274 / 594 / 790 / 1079) — confirm whether `cache_read_input_tokens` is being read from the Claude usage payload at all.
2. Inspect `lib/feature-status.js` aggregation (lines 193, 234, 244, 327, 332) — confirm whether `cachedInputTokens` is passed through from the per-turn record into the agent-level totals.
3. Compare to the `cx` path so the fix matches its shape exactly — same field names, same arithmetic, same `freshInputTokens` derivation.
4. Patch the missing producer step. Likely a one-call-site fix in `telemetry.js` to read `usage.cache_read_input_tokens` (or the SDK's equivalent) into the turn record, then a parallel addition in `feature-status.js` to sum it into `cachedInputTokens` alongside `inputTokens`.
5. Run `aigon perf-bench brewboard cc` against one Sonnet model, diff the new bench JSON against an old one, confirm `tokenUsage.cachedInputTokens > 0` and `tokenUsage.freshInputTokens > 0`.
6. Restart dashboard (`aigon server restart`), open benchmarks panel, take `browser_snapshot`, confirm Tokens In column has a non-zero value for the new row.

The dashboard rendering code (`@aigon/pro` → `dashboard/benchmark-matrix.js`) is correct as-is — it reads `freshInputTokens` and renders it. No changes needed there.

## Dependencies

- None.

## Out of Scope

- Restructuring the benchmark matrix into per-operation grouped columns (separate feature: `benchmark-matrix-per-op-restructure`).
- Pop-out / fullscreen UI for the benchmarks panel.
- Reconciling the tokens-out semantics divergence between `cc` (includes thinking tokens) and `cx` (excludes thinking tokens). Note this as a follow-up but do not fix here.
- Backfilling historical bench JSON files. Old `cc` files keep their zeros.

## Open Questions

- Does the Claude SDK telemetry expose `cache_creation_input_tokens` separately from `cache_read_input_tokens`? If so, decide whether `cachedInputTokens` should be the sum or just `cache_read_input_tokens`. Match whatever `cx` does for parity.

## Related

- Set: agent-benchmarks
- Prior features in set: (none — this is the foundation)
- Surfaced via dashboard agent-benchmarks discussion 2026-04-30.
- Sibling feature: `benchmark-matrix-per-op-restructure` (F462 — column reshape; depends on this fix being live so the Tokens In data is real before the columns get split per-operation).
