# Implementation Log: Feature 650 - dashboard-card-state-hierarchy-redesign
Agent: cu (handoff from cx)

## Status
Implemented F650 card hierarchy: server `cardPresentation` model, pipeline/monitor render, design docs, tests green on `npm run test:iterate`.

## Criteria Attestation
- [x] Shared hierarchy in pipeline + monitor via `cardPresentation` + `card-presentation.js` render helpers
- [x] Single dominant headline; duplicate red/green panels suppressed on close failure (regression: close-failure-event @smoke)
- [x] Quiet progress timeline + compact agent summary on failures
- [x] Recovery actions promoted when `severity === 'error'`; `validActions` eligibility unchanged
- [x] Research + feedback rows attach `cardPresentation` on poll
- [x] `docs/dashboard-card-design.md` + wireframe v4 pointer + AGENTS/CLAUDE/architecture refs
- [ ] Full visual QA screenshot matrix (6 scenarios × 3 breakpoints) — partial: `tmp/f650-close-failure-headline.png` from @smoke; run `aigon preview 650` for remaining states before close

## New API Surface
Poll rows (non-lean): `entity.cardPresentation` `{ severity, contextLine, timeline[], agentSummary, suppress{}, compactAgents, showRecoveryActions }`

## Key Decisions
- Server-side presentation model (`lib/card-presentation.js`) shared by monitor/pipeline; lean done rows skip attachment
- Close-failure conflict files move to headline context; `kcard-close-failure` panel suppressed when headline already says Close failed
- Merge conflict context uses `lastCloseFailure.conflictFiles` in `contextLine`

## Gotchas / Known Issues
- Primary dashboard `aigon server restart` must run from main checkout after `lib/*.js` ship; worktree UI verify via `aigon preview 650`
- Set-card member summaries not fully reworked — only pipeline feature/research cards in this pass

## Explicitly Deferred
- Set-card full hierarchy parity for embedded member status
- Collapsible history disclosure on narrow cards (open question in spec)

## For the Next Feature in This Set
n/a (standalone feature)

## Test Coverage
- `tests/unit/card-presentation.test.js` — timeline, suppression, merge-conflict context
- `tests/dashboard-e2e/close-failure-event.spec.js` — updated for F650 headline (no duplicate panel)
- `npm run test:iterate` — pass (incl. Playwright @smoke)
