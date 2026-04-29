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
  - { from: "inbox", to: "backlog", at: "2026-04-29T04:46:31.692Z", actor: "cli/feature-prioritise" }
---

# Feature: benchmark-matrix-token-columns-and-sorting

<!-- Authoring AI: set `complexity:` using this rubric before writing the spec:
       low       — config tweaks, doc-only, single-file helpers, trivial bug fixes
       medium    — standard feature with moderate cross-cutting, one command handler, small refactor
       high      — multi-file engine edits, new event types, new dashboard surfaces, judgment-heavy deletion work
       very-high — architectural shifts, write-path-contract changes, new XState transitions, cross-cutting template+engine+frontend
     At start time, model and effort defaults come from each agent's `cli.complexityDefaults[<complexity>]` in
     `templates/agents/<id>.json` (not from this spec). Do not put model IDs in the spec. -->

## Summary

Add tokens-in (uncached, computed as inputTokens - cachedInputTokens) and tokens-out (outputTokens) as first-class columns in the perf-bench matrix UI, plus per-column sorting on every numeric/string column. Default sort = by agent (preserves the current grouped-by-agent view); clicking another column header re-sorts globally and shows an arrow indicator. Cost ($, costUsd) is free metadata from F438 and almost certainly worth a third new column. Empty cells render as '—' for pairs whose JSON predates F438 and lacks tokenUsage. Cross-repo consideration: the rich matrix UI lives in aigon-pro per F410's dashboard-routes split; this spec captures the OSS/Pro contract (data shape unchanged from F438) and the implementation may need to transfer to aigon-pro's inbox. Triggered by 2026-04-29 release prep where the user asked for these columns + sorting after seeing the F438 token data live for the first time.

## User Stories
- As a user evaluating which agent/model to pick for a task, I want to see tokens-in (uncached) and tokens-out next to wall time so I can compare agents on context cost as well as speed.
- As a user comparing models on cost, I want a `$` column showing F438's `costUsd` directly in the matrix so I don't have to open per-pair JSONs to read it.
- As a user sorting by speed, I want to click the `total time` column header and see every row reordered globally (not within agent stripes), with an arrow indicating ascending vs descending.
- As a user who landed on the matrix from a deep link, I want the default view to remain "grouped by agent" so the tab feels unchanged for anyone who isn't sorting yet.
- As a user looking at older runs that predate F438's token-axis wiring, I want empty cells rendered as `—` (not blanks, not zeros) so I can tell "not measured" apart from "zero".

## Acceptance Criteria

### Columns
- [ ] **New: tokens-in (uncached)** — computed as `tokenUsage.inputTokens - tokenUsage.cachedInputTokens`. Header label: `tokens in` with a tooltip *"Uncached input tokens — fresh context billed this run."*. Right-aligned, monospace, formatted with k/M suffixes (e.g., `1.2k`, `47k`).
- [ ] **New: tokens-out** — `tokenUsage.outputTokens`. Header label: `tokens out`. Same formatting/alignment as tokens-in.
- [ ] **New: cost (`$`)** — `tokenUsage.costUsd`. Header label: `$`. Formatted with 2 decimal places when ≥ $0.01, 4 decimals when smaller (e.g., `$0.12`, `$0.0034`). Right-aligned.
- [ ] **Existing columns preserved**: agent, model, total time, overhead, baseline, quality (from F438), failure context. Order: agent, model, total, overhead, tokens-in, tokens-out, $, quality.
- [ ] **Empty-cell rendering** — when `tokenUsage` is null on a per-pair JSON (pre-F438 runs, future failed runs), the three new columns render as `—` (em dash) in dimmed text, NOT as `0` and NOT as blank. Sort treats `—` as the lowest value when ascending, highest when descending (consistent with most table UX conventions).

### Sorting
- [ ] **Default sort** = grouped by agent — preserves the current view exactly. Loading the matrix tab for the first time shows agent stripes, alternating colours, no arrow indicators.
- [ ] **Every column header is clickable** — clicking re-sorts globally (drops the agent grouping). Click again to flip direction. Click a third time on the same column to return to "grouped by agent" default.
- [ ] **Sort indicators** — a small arrow (▲ / ▼) appears next to the active column's header. No arrow on inactive columns.
- [ ] **String columns sort lexicographically** (case-insensitive). Numeric columns sort numerically. Empty-cell handling per the rule above.
- [ ] **Sort state persists** in localStorage (`benchmark-matrix-sort: { columnId, direction }`) so a user who picked "tokens-out descending" yesterday gets the same view today.
- [ ] **No keyboard / accessibility regression** — column headers remain `<button>` (or get appropriate `role="button" tabindex="0" aria-sort="..."` if currently `<th>`); arrow keys do not need to navigate sort, but Enter/Space on a focused header must trigger the sort.

### Read-path coupling
- [ ] **No JSON shape change** — F438 already ships `tokenUsage` and `costUsd`. The matrix renderer reads existing fields. Any per-pair JSON committed under `.aigon/benchmarks/` after F438 already qualifies; older JSONs render with the empty-cell rule.
- [ ] **No new `/api` endpoint** — the existing benchmarks read path serves whatever the renderer needs. If the read model needs computed fields (e.g., `freshInputTokens`), prefer computing in the renderer over adding to the JSON.

## Validation
```bash
node --check aigon-cli.js
# In aigon-pro (where the matrix UI actually lives):
#   npm run test:ui --grep "benchmark matrix"   # if a Playwright case is added
#   manual: load Pro dashboard, click each column header, verify sort + arrow + empty-cell rendering
```

## Validation
<!-- Optional: commands the iterate loop runs after each iteration (in addition to project-level validation).
     Use for feature-specific checks that don't fit in the general test suite.
     All commands must exit 0 for the iteration to be considered successful.
-->
```bash
# Example: node --check aigon-cli.js
```

## Pre-authorised
<!-- Standing orders the agent may enact without stopping to ask.
     Each line is a single bounded permission. The agent cites the matching line
     in a commit footer `Pre-authorised-by: <slug>` for auditability.
     The first line below is a project-wide default — keep it unless the feature
     explicitly demands Playwright runs mid-iterate. Add or remove other lines
     per feature.
     Example extras:
       - May raise `scripts/check-test-budget.sh` CEILING by up to +40 LOC if regression tests require it.
-->
- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Technical Approach

### Where the work lands

The OSS aigon repo owns the **data**: per-pair JSONs in `.aigon/benchmarks/` (shape locked by F438), the `lib/perf-bench.js` writer, and the F438-introduced `.bench-cell` / `.bench-token-line` CSS in `templates/dashboard/styles.css`. A grep at spec-write time confirms there is **no rich matrix renderer in OSS** — `templates/dashboard/js/` only references `bench-cell` from `settings.js`. The rich matrix UI (agent stripes, relative-speed bars, summary stat grid, fast/mid/slow buckets, per-row failure pills) lives in **aigon-pro**, layered on top of the OSS dashboard via the F410 routes registry.

That makes this feature **almost entirely an aigon-pro change**. OSS gets at most a documentation note (in `CONTRIBUTING.md` or a small comment in `lib/perf-bench.js`) confirming that `tokenUsage` and `costUsd` are stable fields the matrix consumes.

### Implementation sketch (aigon-pro side)

1. **Add column descriptors** in whatever the matrix's column config is (likely a `BENCH_COLUMNS` array in a Pro dashboard component). Each descriptor: `{ id, header, accessor, formatter, sortable, sortValueOf }` where `sortValueOf` returns the comparable value (handling null → -Infinity for ascending semantics, or the inverse based on direction).
2. **Sort state machine**: tri-state per column — *(none)* → *asc* → *desc* → *(none, return to agent grouping)*. State stored in component memory and mirrored to `localStorage`.
3. **Render path**: when `sortColumnId == null`, group rows by `agentId` and emit stripes in registry order (current behaviour). When `sortColumnId != null`, flatten rows, apply `Array.prototype.sort` with the active comparator, and skip the stripe colouring (or keep it, with each row coloured by its own agent — minor visual call for the implementer).
4. **Empty-cell semantics**: `tokenUsage == null` rows render `—` for the three new columns. In sort comparators, `null` is the lowest value when `direction === 'asc'`, highest when `direction === 'desc'`. (This means clicking a token column descending floats unmeasured rows to the top, which is probably fine — they're the outliers worth fixing.)
5. **Number formatting helpers**: `formatTokens(n)` → `1.2k` / `47k` / `1.2M`; `formatCost(n)` → `$0.12` / `$0.0034`. Both ~5-line pure functions; co-locate with the column descriptors.
6. **Accessibility**: column headers use `aria-sort="ascending" | "descending" | "none"` to expose state to screen readers. Arrow indicator is decorative (`aria-hidden`).
7. **Tests** — at least one Playwright case in aigon-pro that loads the matrix, clicks the `tokens out` header twice, and asserts the topmost row's `tokens out` value is the maximum across all rows.

### Why no OSS API change

The matrix already reads `.aigon/benchmarks/*.json` files directly (or via a thin Pro endpoint). All the fields it needs (`tokenUsage.inputTokens`, `tokenUsage.cachedInputTokens`, `tokenUsage.outputTokens`, `tokenUsage.costUsd`) are present in F438-era JSONs. **No new endpoint, no new field.** This is a pure rendering change.

### Cross-repo housekeeping

If the implementer agrees this is purely aigon-pro work, the cleanest move is to **transfer this spec to aigon-pro's inbox** before starting. Per memory, "aigon and aigon-pro have separate spec folders since 2026-04-07; routing rules + counter behaviour + cross-repo convention". This spec was filed in aigon's inbox because that's where the conversation happened; it should not stay there if no OSS code is touched. The first action of whoever picks this up is to verify the OSS-touch claim and either (a) move the spec to aigon-pro's inbox, or (b) carve a minimal OSS slice (likely just docs) and keep the bulk in a coordinated aigon-pro feature.

## Dependencies
- F438 — token-usage axis — provides `tokenUsage` and `costUsd` fields the new columns render. **Already shipped in 2.62.0**, so the dependency is satisfied at spec-creation time.
- F410 — dashboard-routes split — establishes that Pro layers UI on top of OSS without touching OSS code. This feature follows that pattern.

## Out of Scope
- **JSON schema changes.** F438 already ships everything needed.
- **OSS dashboard matrix UI.** OSS does not have a rich matrix; this spec does not introduce one. If there's appetite for an OSS-side basic matrix later, that's a separate feature.
- **Filtering / search.** Sorting only — no filter-by-agent, no search box. Add if asked, separately.
- **Chart / sparkline cells.** Tokens-over-time per pair would be lovely but is its own feature.
- **Re-running depleted-row pairs from the UI.** A "re-run this pair" button on each row is a separate UX concern; this spec only renders.
- **Cross-release diff view.** v2.61-vs-v2.62 token deltas would be a separate feature; F441 explicitly excluded the comparison surface.

## Open Questions
- Tri-state sort (none → asc → desc → none) vs two-state (asc / desc, no return to default) — implementer call. Two-state is simpler; tri-state preserves the "back to agent grouping" affordance. My recommendation in the acceptance criteria is tri-state, but a third click is a small UX cost.
- When sorted globally (not by agent), do agent stripes stay (each row coloured by its agent) or disappear (uniform background)? Visual call. Stripes-stay is more informative; uniform is cleaner.
- Should `tokens-in (cached)` also be a column? F438 captures it. Probably not — three new columns is already a lot of horizontal space; cached tokens are a niche metric most users don't reason about. Add if specifically requested later.
- localStorage key naming — namespaced (`aigon.bench-matrix.sort`) or simple (`benchmark-matrix-sort`)? Pro convention call.

## Related
- F438 (token + judge axes for perf-bench) — provides the data shape. Shipped 2.62.0.
- F441 (benchmark JSON artifact policy) — confirmed `.aigon/benchmarks/` is tracked and authoritative; release-frozen runs feed this matrix forever.
- F410 (dashboard-routes split) — Pro layering pattern.
- Originating conversation — 2026-04-29, after the user saw F438's token data live and asked for tokens-in / tokens-out columns + sortable matrix.
