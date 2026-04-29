---
complexity: high
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-29T22:03:15.665Z", actor: "cli/feature-prioritise" }
---

# Feature: benchmark-matrix-per-op-restructure

## Summary

The Pro agent benchmarks matrix currently has one row per (agent, model) and one shared set of telemetry columns (Tokens In, Tokens Out, $, Last Run) — even though the matrix tracks two distinct operations (Implementation, Review). Today only Implementation has a Time column with a bar chart; Review is just a checkmark. This makes it impossible to answer "what's the cheapest reviewer?", "what's the fastest reviewer?", or any per-operation comparison. Restructure the matrix so each operation owns its own grouped column block — Time, Tokens In, Tokens Out, $, Quality, Last Run — and add a derived "value-for-money" column that combines quality, cost, and time into a single sortable score per operation.

## User Stories

- [ ] As an operator picking an implementation agent, I can sort by `Implementation › $` to find the cheapest, by `Implementation › Time` to find the fastest, and by `Implementation › Quality` to find the best.
- [ ] As an operator picking a reviewer, I can sort by `Review › $`, `Review › Time`, or `Review › Quality` to answer the same questions for the review path.
- [ ] As an operator wanting one number that balances cost, speed, and quality, I can sort by `Implementation › Value` or `Review › Value` and see a derived score.
- [ ] As an operator, I can see Implementation and Review "Last Run" timestamps independently — a Review run from 3h ago does not pretend Implementation also ran 3h ago.

## Acceptance Criteria

- [ ] The matrix renders two grouped column blocks: **Implementation** and **Review**. Each block contains: Time, Tokens In, Tokens Out, $, Quality, Last Run, Value.
- [ ] Each column in each block is independently sortable. Clicking a column header sorts the matrix by that column; clicking again reverses; clicking a third time clears sort.
- [ ] Group headers span their child columns visually (e.g. via `colgroup` + a header row spanning the right number of columns).
- [ ] When a row has no data for an operation, all columns in that operation's block render as `—` (em-dash), not 0 or empty.
- [ ] The Quality column reads `quality.score` from the bench JSON when present and renders one decimal place (e.g. `9.2`); otherwise `—`.
- [ ] The Value column is a derived score per operation: `Value = Quality / (cost_norm × time_norm)` where `cost_norm` and `time_norm` are min-max normalised across the visible non-empty rows in that operation's block, with both clamped to `[0.05, 1]` to avoid divide-by-near-zero. Rows missing any of {Quality, $, Time} show `—`.
- [ ] Last Run is per-operation: each operation block reads its own newest matching bench file timestamp, not a shared "row-wide newest".
- [ ] The header tooltip on Value explains the formula in one sentence and notes that normalisation is column-relative.
- [ ] The matrix still respects the existing `kinds` model — adding a third operation later (e.g. `eval`) requires only a `kinds` array entry, not a column-block rewrite.
- [ ] No regression in existing sortable behaviour: Agent, Model, and the legacy column IDs that still apply continue to sort correctly.
- [ ] Visual verification via `browser_snapshot` after the dashboard restart confirms the grouped header structure and that all three "sort by X" stories work end-to-end.

## Validation

```bash
node -c aigon-cli.js
npm test
MOCK_DELAY=fast npm run test:ui
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Technical Approach

Source file: `aigon-pro/dashboard/benchmark-matrix.js` (~660 lines). The current column model in that file:

- `kinds` array (Implementation, Review) drives the per-operation TIME columns.
- A single `tokenColumns` array (`tokens_in`, `tokens_out`, `cost`) sits outside the kinds loop and pulls from `rowTokenAgg(row)` — a row-level aggregate that picks the newest bench file across operations.
- `last_run` is also a single column reading the newest timestamp across the row.

Reshape:

1. **Promote per-operation aggregation.** Replace `rowTokenAgg(row)` with `opAgg(row, kindId)` — returns `{time, freshIn, out, cost, quality, lastRun}` for the bench file matching that operation only. Bench files already carry `taskType` (`do` / `review`); use that to filter.
2. **Restructure column generation.** For each kind in `kinds`, emit Time, Tokens In, Tokens Out, $, Quality, Last Run, Value as that block's columns. Drop the standalone `tokenColumns` array and the standalone `last_run`.
3. **Add a two-row header.** Top row: agent | model | (Implementation spanning 7) | (Review spanning 7). Bottom row: per-column sortable buttons. Use a `<colgroup>` for the operation spans and a CSS rule to render the visual divider between blocks.
4. **Sort key namespacing.** Today sort IDs are flat (`tokens_in`, `tokens_out`, `cost`, `last_run`, `kind:<id>`). New scheme: `op:<kindId>:<field>` where field ∈ `{time, tokens_in, tokens_out, cost, quality, last_run, value}`. Update `buildSortValueFn`, the persisted sort state, and the click handler. Migrate any persisted sort state by clearing it on first load of the new version (one-line guard).
5. **Quality column.** Read `quality.score` from the bench JSON (already present per F371 implementation rubric and the symmetric review rubric when available). Format to one decimal. Sort numerically.
6. **Value column.** Derived per render. For each operation, take the visible rows with all of `{quality, cost, time}` non-null, min-max normalise cost and time across those rows, clamp the normalised values to `[0.05, 1]`, compute `quality / (cost_norm × time_norm)`. Render with one decimal and a small tooltip showing the three inputs. Recompute on filter/sort changes (cheap; <100 rows).
7. **Per-operation Last Run.** Each operation column block reads `opAgg(row, kindId).lastRun`. The page-level "Last Run" stat in the section header keeps its current "newest across everything" semantics — that's a separate widget.

Non-functional constraints:

- The matrix is wide. Don't address pop-out / fullscreen here — that's a separate follow-up feature. Keep the existing horizontal scroll behaviour and let the table grow.
- Don't change the bench JSON shape. All new derived data is read-only at render time.
- Keep `kinds` extensible — a future third operation must only require adding to `kinds` and (if its rubric exists) populating Quality.

## Dependencies

- depends_on: perf-bench-claude-tokens-in-fix — without this, the new `Implementation › Tokens In` column for `cc` rows still shows zeros. The restructure should land on top of meaningful data.

## Out of Scope

- Pop-out / fullscreen view for the benchmark panel. Tracked separately. (Plan: a URL-routable overlay pattern — `#focus=benchmarks` — so deep links work and the same pattern can promote any settings section to fullscreen later.)
- Reconciling tokens-out semantics between `cc` (includes thinking) and `cx` (excludes thinking). Worth a separate spec; out of scope here.
- Backfilling Quality scores for historical bench files that predate the rubric work.
- Adding a third operation kind. Keep the structure extensible but don't introduce new kinds in this feature.
- Editing the bench JSON shape or the writer. This feature is render-only.

## Open Questions

- Does the Review path already write `quality.score` consistently? If the review rubric isn't yet emitting scores into bench JSON, the Quality column for Review will be `—` for older runs; confirm the rubric coverage and note any gap as a follow-up rather than blocking this feature.
- Should Value have an adjustable weighting (slider for quality vs cost vs time importance)? Default no — ship the unweighted formula first, observe whether the user reaches for it.

## Related

- Surfaced via dashboard agent-benchmarks discussion 2026-04-30.
- Depends on: `feature-perf-bench-claude-tokens-in-fix`.
- Follow-up: pop-out / fullscreen-overlay for benchmarks panel using URL-routable hash routing.
- Quality rubric: F371 (implementation-v1 rubric); symmetric review rubric work if/when it lands.
