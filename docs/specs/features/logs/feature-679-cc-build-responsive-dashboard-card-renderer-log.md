---
commit_count: 10
lines_added: 1409
lines_removed: 83
lines_changed: 1492
files_touched: 21
fix_commit_count: 1
fix_commit_ratio: 0.1
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: true
input_tokens: 754
output_tokens: 278320
cache_creation_input_tokens: 1011534
cache_read_input_tokens: 76960241
thinking_tokens: 0
total_tokens: 78250849
billable_tokens: 279074
cost_usd: 103.528
sessions: 1
model: "claude-fable-5"
tokens_per_line_changed: null
---
# Implementation Log: Feature 679 - build-responsive-dashboard-card-renderer
Agent: cc

## Status
Contract-driven card renderer shipped as pure ES modules (`templates/dashboard/js/contract-cards/` + `styles/contract-cards.css`) behind the default-off `dashboard.contractCards` setting; pipeline feature/research cards and set bundle headers render from `uiContract` while dispatching through the unchanged `handleFeatureAction`/`handleSetAction`/`openTerminalPanel` boundaries, and the gallery Cards/Pipeline views now import the production modules (adapter drawers for clicks).

## New API Surface
`renderContractCardBody(contract, options)` / `renderSetContractCardBody(contract, options)` from `js/contract-cards/card.js` (options are view-only: `density`, `badgeLabel`, `canPeekSession`, `suppressActions`, `suppressIdentity`); `/api/status` repos carry `contractCardsPreview: boolean`.

## Key Decisions
Renderer emits legacy dispatch hook classes (`kcard-va-btn`, `kcard-peek-btn`, `kcard-overflow-toggle`) so existing wiring is the single command path; gallery set fixtures now emit production-shaped `specCycle` facts (they previously only carried raw session refs, which the contract renderer correctly refuses to read as status).

## Gotchas / Known Issues
`npm run test:gallery` binds port 3700 and a long-lived gallery server from the main checkout was already listening — suite verified green (6/6) against this worktree on `--port=3701`. Gallery e2e scenario count was stale at 66 (builder emits 67 since F678; test:gallery is in no push gate, so it drifted silently).

## Explicitly Deferred
Peek on a session whose tmux is fully gone opens the shared terminal panel and shows "[Session ended]" — server-side retained console for dead sessions does not exist yet (contract `console-snapshot` target is honored for ended-but-alive panes). Legacy card builder untouched; removal is F682.

## For the Next Feature in This Set
F680: render through `renderContractCardBody` with `density: 'compact' | 'expanded'` per column — never fork the markup; anything the responsive Pipeline needs that isn't a view concern belongs in the contract, not in renderer options. Preview e2e patterns (real gallery contracts inside mocked `/api/status` with `contractCardsPreview: true`) live in `tests/dashboard-e2e/contract-cards-preview.spec.js`.

## Test Coverage
`tests/dashboard-e2e/contract-cards-preview.spec.js` (@smoke, 7 tests incl. default-off pin); gallery e2e updated to production markup (6 tests incl. new labeled-pill Peek test); unit 37/37; iterate gate green.

## Code Review

**Reviewed by**: cu
**Date**: 2026-07-15

### Fixes Applied
- None — implementation was clean

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- None

### Notes
- Contract renderer modules are pure contract→HTML with legacy dispatch hooks; pipeline and set-header wiring correctly reuse `handleFeatureAction`, `handleSetAction`, and `openTerminalPanel`.
- Preview toggle (`dashboard.contractCards`, default off) is wired through settings, collector (`contractCardsPreview`), and status fingerprint — toggling repaints cards as required.
- Gallery imports production modules with an adapter for drawers; set gallery fixtures now emit production-shaped `specCycle` facts.
- Deferred items in the implementation log (dead-session Peek, legacy builder removal in F682) are appropriately scoped and documented.
