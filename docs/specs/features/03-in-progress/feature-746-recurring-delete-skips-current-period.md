---
aigon_id: F746
complexity: medium
---

# Feature: Recurring delete skips current period

## Summary

Make deletion durable for generated recurring features. When an operator deletes a weekly, monthly, or quarterly feature instance, Aigon must record that instance's cadence period as intentionally handled before removing the spec. The background recurring check must then leave it deleted for that period and resume normal generation only in the next period.

## Problem

`feature-delete` removes the generated feature spec and workflow state, but recurring status is tracked separately in `.aigon/recurring-state.json`. If that state is absent or stale, deleting the only open instance makes its template immediately due. The dashboard server's automatic recurring check can recreate the feature after a restart, making deletion appear ineffective.

## User Stories

- [ ] As an operator, when I delete a generated recurring feature, it stays absent for the rest of that feature's week, month, or quarter.
- [ ] As an operator, deleting one period does not disable the recurring template permanently; the next period can still generate normally.
- [ ] As a maintainer, ordinary non-recurring feature deletion remains unchanged and deletion fails safely if Aigon cannot persist the recurring disposition.

## Acceptance Criteria

- [ ] `feature-delete` recognizes a recurring feature from `recurring_slug` plus exactly one of `recurring_week`, `recurring_month`, or `recurring_quarter` in the instance frontmatter.
- [ ] Before removing a recognized recurring spec, Aigon writes that exact instance period to the existing recurring-state entry (`lastWeek`, `lastMonth`, or `lastQuarter`) and records a deletion timestamp without discarding other cadence fields.
- [ ] If recurring disposition state cannot be written, deletion exits non-zero and leaves the spec and workflow intact rather than allowing immediate regeneration.
- [ ] The server's next automatic recurring check and a manual `aigon recurring-run` both skip a deleted instance for the recorded period.
- [ ] A later weekly, monthly, or quarterly period remains eligible for normal generation.
- [ ] Non-recurring feature deletion and research deletion retain their existing behavior and do not create recurring state.
- [ ] CLI output explicitly confirms the cadence period that was skipped.
- [ ] Public recurring-feature documentation explains that deleting a generated instance skips its current cadence period rather than disabling its template.
- [ ] Focused regression coverage exercises weekly, monthly, and quarterly instances through the real `feature-delete` and `recurring-run` commands.
- [ ] Recurring generation stages and commits only the newly generated spec, never unrelated edits or already-staged operator work.

## Validation

```bash
node tests/integration/lifecycle-source-deletion.test.js
npm run test:iterate
```

## Pre-authorised

## Technical Approach

1. Add a focused `markRecurringInstanceDeleted(repoPath, specContent)` helper in `lib/recurring.js`. Parse the instance frontmatter, recognize only valid generated-instance shapes, merge the exact period into `.aigon/recurring-state.json`, and return a small disposition DTO for CLI output.
2. Call the helper from the feature path in `entityDelete` after all lifecycle/dependency eligibility checks but before `git rm` or workflow removal. Fail closed on state-write errors. Research and ordinary features bypass the helper.
3. Continue using the existing `lastWeek`/`lastMonth`/`lastQuarter` fields so `checkRecurringFeatures` and `listRecurringStatus` require no second source of truth. Preserve any other cadence stamps already stored for the same recurring slug.
4. Narrow recurring generation's Git add/commit pathspec to the generated backlog spec so a background run cannot sweep concurrent work into its commit.
5. Add focused integration coverage that seeds recurring templates and instances, deletes them, runs the recurring checker, and proves that nothing is recreated and unrelated staged work remains untouched.
6. Document current-period skip semantics and the distinction between deleting an instance and removing/disabling its recurring template.

## Dependencies

- `lib/entity.js` deletion pipeline.
- `lib/recurring.js` cadence state and automatic generation checks.
- `.aigon/recurring-state.json`, which is already included in Aigon backup/sync state.

## Out of Scope

- Disabling or deleting recurring templates.
- A new recurring-template settings UI or skip command.
- Restoring previously deleted recurring instances.
- Changing cadence calculations or the dashboard server's recurring-check interval.
- Making recurring state part of workflow-core feature events.

## Open Questions

- None. Deletion skips only the exact period recorded on the generated instance.

## Related

- F320 — recurring-features
- F707 — merged recurring engine
- `site/content/guides/recurring-features.mdx`
