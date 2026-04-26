---
complexity: low
---

# Feature: mock-delay-fast-default-in-ci

## Summary
Default `MOCK_DELAY=fast` for CI dashboard-e2e runs. Today `tests/dashboard-e2e/_helpers.js:11` honours the env var (drops implement/submit delays to 600ms / 300ms), but CI runs at default delays which makes the solo lifecycle ~25s instead of ~7s. With three new specs landing (fleet, failure-modes), the speedup is increasingly load-bearing. Includes an audit of any test that would silently break under fast delays so we don't trade speed for flakes.

## User Stories
- [ ] As a CI consumer, the dashboard-e2e tier finishes ~3× faster without reducing assertion coverage.
- [ ] As a test author, the same `MOCK_DELAY=fast` envelope is the default everywhere, removing one source of "works locally, slow in CI" drift.

## Acceptance Criteria
- [ ] CI runs `MOCK_DELAY=fast` by default (set in `scripts/`, GitHub Actions workflow file, or `_helpers.js` based on `process.env.CI`).
- [ ] All current dashboard-e2e specs pass under fast delays — no test relies on the slower defaults to mask a race.
- [ ] An audit comment in `_helpers.js` or a small README note documents the default and the audit conclusion.
- [ ] Local default behaviour (no `MOCK_DELAY` set, no `CI` env) is unchanged unless the user explicitly opts in, to keep `unset MOCK_DELAY npm run test:ui` behaviour stable.
- [ ] `npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh` passes.

## Validation
```bash
CI=1 npm run test:ui
```

## Pre-authorised

## Technical Approach
- Most direct: in `tests/dashboard-e2e/_helpers.js`, treat `process.env.CI === 'true'` as equivalent to `MOCK_DELAY=fast` (already partly supported per the cu finding — confirm and finalise).
- Run the full suite once with the new default to flush out any race-sensitive specs.
- Tiny diff (~5–10 LOC + one audit run) — likely fits inside any other Set member's PR if convenient, but kept as its own feature for clean attribution.

## Dependencies
-

## Out of Scope
- Reducing `MOCK_DELAY=fast` values further (already 600/300 ms).
- Speed work outside the dashboard-e2e tier.

## Open Questions
- Does `_helpers.js` already check `process.env.CI`? Confirm during implementation; if yes, this feature degrades to "make CI honour it cleanly + audit."

## Related
- Research: 42 — simulate-agents
- Set: simulate-agents
- Prior features in set: mock-agent-tmux-mode, dashboard-e2e-fleet-lifecycle, dashboard-e2e-failure-modes
