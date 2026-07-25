---
complexity: medium
---

# Feature: Feature-set current-member close recovery action

## Summary
Expose and correctly dispatch the embedded current feature's server-approved
recovery actions from an expanded feature-set card, so an operator can launch
`Resolve & close` after an autonomous set member fails to merge.

## User Stories
- [ ] As an operator taking over a failed autonomous set, I can launch the
      current feature's agent-assisted close recovery without leaving the set card.
- [ ] As an operator, I can distinguish feature actions from set-level resume
      and reset actions, and each action targets the correct entity.

## Acceptance Criteria
- [ ] The embedded current-feature contract in a feature-set card renders its
      card-surface actions rather than suppressing them.
- [ ] An embedded `feature-resolve-and-close` button dispatches through
      `handleFeatureAction` with the current feature row and its matching
      `validActions` entry; set actions continue to dispatch through
      `handleSetAction`.
- [ ] A stopped or paused set whose current feature has a merge-conflict close
      failure visibly offers `Resolve & close` alongside the set recovery actions.
- [ ] Gallery/unit and dashboard browser regression coverage pin the rendering
      and dispatch behavior.
- [ ] No frontend lifecycle eligibility is introduced: actions and labels remain
      sourced from the feature and feature-set UI contracts.

## Validation
```bash
node tests/unit/dashboard-card-gallery.test.js
npx playwright test tests/dashboard-e2e/contract-cards-preview.spec.js --config tests/dashboard-e2e/playwright.config.js
npm run test:iterate
```

## Pre-authorised
<!-- Optional: grant specific policy-gate skips for this feature only.
     Each line is a single bullet authorising one action. When an agent proceeds
     under a line, the commit footer must be `Pre-authorised-by: <slug>` where
     `<slug>` is the slugified line text (lowercase, non-alphanumerics → hyphens).
     Slugs are validated against this section at feature-close — invented footers block close. -->

## Technical Approach
Keep workflow eligibility server-owned. Update the contract set-card renderer
to include the embedded feature contract's action bar. In the pipeline wiring,
route buttons inside `.ccard-set-current` against the current member's real
feature row and `validActions`; route all remaining buttons against the set's
`validActions`. Extend the gallery's failed-set fixture so its current member
uses a real merge-conflict recovery contract, then assert rendering and click
dispatch in the existing contract-card preview coverage.

## Dependencies
- Existing feature UI contract and feature-set UI contract.
- Existing `feature-resolve-and-close` dashboard action handler.

## Out of Scope
- Changing close-failure lifecycle semantics or set-conductor resume behavior.
- Automatically resolving merge conflicts without an agent session.

## Open Questions
- None.

## Related
- Prior work: F338 close-failure resolve action; F678/F679 contract cards.
