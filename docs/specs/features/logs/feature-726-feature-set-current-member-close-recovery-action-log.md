# Implementation Log: Feature 726 - feature-set-current-member-close-recovery-action

## Plan

- Preserve server-owned action eligibility and expose the already-embedded
  feature contract's action bar.
- Dispatch embedded actions against the current feature row while keeping the
  outer footer wired to the feature-set action handler.
- Pin rendering and request targeting with gallery and Playwright regressions.

## Progress

- Removed action suppression from the current-feature renderer.
- Added feature-aware dispatch wiring for buttons inside `.ccard-set-current`.
- Added a paused-set merge-conflict gallery scenario and regression assertions.
- Validation passed: gallery unit test, focused Playwright recovery test,
  code-tour check, and `npm run test:iterate` with all 32 browser smoke tests.

## Decisions

- No lifecycle policy was added to the browser. The feature and set
  `validActions` arrays remain authoritative.
- The existing active feature row supplies dispatch metadata; the embedded
  contract supplies presentation. This avoids duplicating command semantics in
  the feature-set contract.
