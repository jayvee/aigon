# Implementation Log: Feature 742 - research-dashboard-recent-first-ordering

## Status

Implemented and verified against the live Machine B dashboard. R67 now renders
first in the Aigon research Inbox instead of behind the overflow control.

## New API Surface

None.

## Key Decisions

- Sort non-closed research cards by `createdAt` (falling back to `updatedAt`),
  newest first.
- Preserve existing feature ordering and closed-lane ordering.
- Use numeric-ID descending and then name as deterministic timestamp ties.

## Gotchas / Known Issues

- The dashboard's all-repos view displays every repo section; recent-first order
  applies independently within each research lane.

## Explicitly Deferred

- Cleanup of stale R29/R52 workflow state; assessed separately during live
  verification.

## For the Next Feature in This Set

None.

## Test Coverage

- `node tests/unit/dashboard-pipeline-order.test.js` pins R67 ahead of older
  numeric and unnumbered topics and confirms feature ordering is unchanged.
- `npm run test:iterate` passed its dashboard scoped checks and browser smoke.
- Live Chrome verification confirmed R67 is the first card in Aigon's Inbox.
