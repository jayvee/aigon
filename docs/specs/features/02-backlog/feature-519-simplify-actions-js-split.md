---
complexity: high
set: architecture-simplify-2026-05
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-12T00:34:53.274Z", actor: "cli/feature-prioritise" }
---

# Feature: simplify-actions-js-split

## Summary

`templates/dashboard/js/actions.js` is **3,482 lines in a single file with 91 functions** — by far the largest single frontend file (the next-largest, `pipeline.js`, is 1,861). It mixes the per-card action button renderer (`renderActionButtons`), per-action click handler (`handleFeatureAction`), inline modal definitions for nearly every action (start / review / eval / close-with-cherry-pick / spec-review / etc.), the shared triplet-picker UI, and `fetch()` wrappers. Across the dashboard JS there are **144 `innerHTML` writes** and **83 `fetch()` calls**, most concentrated here. This is the highest-risk item in the architecture-simplify set because it touches the most user-visible code — schedule it last and lean hard on Playwright coverage.

## User Stories

- [ ] As a customer loading the dashboard, the JS payload is smaller because per-action modal code is lazy-loaded on first click.
- [ ] As an agent tweaking the "feature-close" modal, I open `templates/dashboard/js/actions/close.js` (~150 LOC) instead of `actions.js` (~3,500 LOC).
- [ ] As a security-conscious reviewer, the per-action split forces a per-action audit of `innerHTML` usage and creates a natural seam to standardise on a small `el()` helper.

## Acceptance Criteria

- [ ] `templates/dashboard/js/actions.js` shrinks to ≤500 LOC. Remaining content: `renderActionButtons` (the card-level button renderer), the `handleFeatureAction` dispatcher, and shared utilities like `tripletsToCliArgs` / `setPickerRecommendation`.
- [ ] Each modal-bearing action lives in `templates/dashboard/js/actions/<action>.js`: at minimum `start.js`, `review.js`, `eval.js`, `close.js`, `spec-review.js`, `pause.js`, `nudge.js`, `delete.js`, `reset.js`. Each file is ≤400 LOC.
- [ ] The dispatcher in `actions.js` lazy-loads action modules on first click using dynamic `import()` — initial dashboard JS payload for the actions surface drops by ≥50%.
- [ ] All 144 `innerHTML` writes across `templates/dashboard/js/` are reviewed during the migration. Any write that interpolates user-controlled content uses the existing `escHtml` helper. Document the pass in the implementation log.
- [ ] `npm run test:browser` passes. The dashboard-e2e suite is extended with at least one new test that exercises lazy-load (e.g. assert the close modal's JS is fetched only after the button is clicked).
- [ ] Bundle-size budget: measured initial JS payload for `/` (excluding xterm vendor) drops by ≥30%. If not, the lazy-loading isn't working.

## Validation

```bash
npm run test:browser
# Size checks
wc -l templates/dashboard/js/actions.js                # expect: < 600
wc -l templates/dashboard/js/actions/*.js | tail -1    # report total
# Lazy-load verification (Network tab)
# Load /, observe initial JS; click "Close" on a feature; assert close.js fetched on click
```

## Technical Approach

- **Per-action split first, lazy-load second.** Land the static split (everything still imported eagerly) and prove no regression via Playwright. Then convert to dynamic imports in a follow-up commit.
- **Modal contract.** Each `actions/<action>.js` exports `{ open(feature, repoPath, options), close() }`. The dispatcher in `actions.js` calls `open` and never reaches inside.
- **Shared helpers stay in `actions.js`.** `tripletsToCliArgs`, `setPickerRecommendation`, `fetchSpecRecommendation`, `escHtml` — all stay shared.
- **Risk control.** Take a Playwright screenshot of every modal before and after via the existing e2e setup. Diff in CI.

## Dependencies

- None on the other architecture-simplify features (frontend split is independent of lib refactors). However, schedule **after** the lib-side simplifications because frontend changes are higher-risk to ship and need a quiet baseline.

## Out of Scope

- Replacing `innerHTML` with DOM construction wholesale — too risky for one feature. Limited to auditing existing writes during the per-action split.
- Adopting a frontend framework (React, Lit, etc.). The split keeps vanilla JS.
- Changing modal visual design. Use `Skill(frontend-design)` if any visual change is unavoidable.

## Open Questions

- Where do shared modal primitives (`showConfirm`, `showDangerConfirm`) live? Suggest `templates/dashboard/js/modals/primitives.js`.
- Do we ship the lazy-load conversion in the same feature or split it? Lean toward same feature so the bundle-size win is measurable in one commit range.

## Related

- Set: architecture-simplify-2026-05
