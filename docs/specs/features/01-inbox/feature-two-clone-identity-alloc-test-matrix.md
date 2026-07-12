---
complexity: medium
depends_on: [667]
---

# Feature: two clone identity alloc test matrix

## Summary

Follow-up from review escalation on feature 667 (subsystem):

Acceptance criteria list two-clone coverage for parallel research creates, CAS retry after a lost race, and crash-after-reservation; branch ships parallel feature + sequential in-process research + pending-gap tests only. Safe to land core allocator; follow-up test hardening is separate harness work.

## User Stories
- [ ] As an operator, the follow-up work from the escalated review finding is tracked as its own feature.

## Acceptance Criteria
- [ ] The escalation reason is addressed or explicitly superseded.

## Validation

```bash
npm run test:iterate
```

## Pre-authorised
