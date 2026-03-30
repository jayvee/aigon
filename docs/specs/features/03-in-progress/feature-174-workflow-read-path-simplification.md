# Feature: feature-workflow-read-path-simplification

## Summary
Remove the remaining duplicated and folder-driven active-feature read paths so workflow snapshot state becomes the single live authority for feature lifecycle, actions, and spec resolution. The goal is not another abstraction layer. The goal is controlled subtraction: delete fallback reads, remove conflicting interpretations, and make the dashboard/CLI consume one feature availability model with less code than today.

## User Stories
- [ ] As an AIGON user, I want the dashboard, CLI, and agent prompts to show the same feature state and available actions so I can trust the system during feature work.
- [ ] As an AIGON maintainer, I want active features to be discovered from workflow state rather than folder placement so runtime behavior is not corrupted by misplaced specs or stale file layout.
- [ ] As an AIGON architect, I want this simplification to delete old paths instead of adding more compatibility code so the system is easier to reason about and cheaper to change.

## Acceptance Criteria
- [ ] Active feature discovery in AIGON reads from workflow snapshots/events only. Folder location is not used to decide whether a feature is active, in-progress, evaluating, paused, ready-for-review, closing, or done.
- [ ] `aigon feature-list --active`, `aigon feature-spec <ID>`, the dashboard feature card payload, and the feature detail payload all agree on the active feature stage and visible spec path.
- [ ] Folder movement remains projection only. If the visible spec is missing or misplaced, the dashboard and CLI still report the workflow lifecycle correctly and surface the projection problem explicitly instead of changing feature meaning.
- [ ] The feature availability/action interpreter for active features has one domain-level read path shared by dashboard and CLI-facing consumers. No dashboard-only feature action logic duplicates feature lifecycle decisions.
- [ ] Feature prompts/templates for implementation, review, eval, close, reset, and cleanup use `feature-spec` / `feature-list` or the shared availability query, not direct `03-in-progress` / `04-in-evaluation` globbing for active features.
- [ ] Deleted code materially outweighs added code for the implementation of this feature, or the PR explains any exception with a concrete removal follow-up in the same branch.
- [ ] Automated tests cover the main transition matrix for active features without requiring live agents:
  - start
  - implementing
  - review running / review complete
  - eval running
  - ready for review
  - close
  - paused / resumed
  - session lost / recovery
- [ ] Tests assert that folder drift does not change active feature lifecycle state.

## Validation
```bash
node lib/feature-spec-resolver.test.js
node lib/workflow-signals.test.js
node lib/workflow-core/workflow-core.test.js
node lib/dashboard-server.test.js
node aigon-cli.js feature-list --active --json
node aigon-cli.js workflow-rules --json
```

## Technical Approach
Use a deletion-first plan with explicit cut points:

1. Define the target boundary.
   Active feature truth comes from workflow-core only:
   - `.aigon/workflows/features/{id}/snapshot.json`
   - `.aigon/workflows/features/{id}/events.jsonl`
   Visible spec folders remain projection/output only.

2. Collapse active feature reads onto one domain read model.
   Replace feature-specific folder fallback logic with one shared feature availability/query path that returns:
   - lifecycle state
   - visible spec path
   - available actions
   - review/eval/runtime summaries
   - projection/drift warnings
   This model must be presentation-neutral so dashboard, CLI, and future consumers can all use it.

3. Delete folder-based active feature discovery.
   Remove any code that decides active feature state from:
   - `docs/specs/features/03-in-progress`
   - `docs/specs/features/04-in-evaluation`
   - `docs/specs/features/06-paused`
   for engine-managed features.
   Keep folder scans only for inbox/backlog or for non-feature entities until they are migrated.

4. Delete duplicate feature action derivation.
   Audit and remove overlapping feature action logic from:
   - `lib/state-queries.js`
   - `lib/workflow-read-model.js`
   - `lib/workflow-snapshot-adapter.js`
   - dashboard-specific action promotion code
   The end state should be one feature availability/action interpreter plus thin presenters.

5. Make drift explicit.
   If workflow snapshot says a feature is active but the visible spec cannot be found where the projection expects it, expose a projection error/warning. Do not silently reinterpret lifecycle from folder state.

6. Lock down with tests before manual runs.
   Add fixture-driven tests that simulate feature lifecycle and runtime signals without live agents. The dashboard tests should assert rendered action/state outputs from the shared read model, not from ad hoc folder heuristics.

7. Measure subtraction.
   At the end of implementation, produce a before/after diff summary showing:
   - lines added
   - lines deleted
   - modules removed or simplified
   - which fallback paths were deleted

Implementation constraints:
- Do not add “temporary compatibility” for active feature folder reads.
- Do not reintroduce manifest/coordinator state as lifecycle authority.
- Do not fix drift by copying files around earlier in the flow; fix the read/write authority boundary instead.

## Dependencies
- Existing workflow-core feature lifecycle and snapshot read path
- Existing `feature-spec` / `feature-list` query surface introduced on `main`

## Out of Scope
- Migrating research lifecycle to workflow-core in the same change
- UI redesign of the dashboard
- Changing the visible feature folder taxonomy itself
- Preserving folder-driven active feature behavior for legacy in-progress features; they can be reset/killed instead

## Open Questions
- Should the shared feature availability model replace `feature-dashboard-model.js`, or should that file be renamed and repurposed rather than extended?
- Which remaining consumers still infer active feature state from folder layout after prompt/template updates are installed?
- Should projection drift be surfaced as a dashboard badge, CLI warning, or both?

## Related
- Research:
- [docs/architecture.md](/Users/jviner/src/aigon/docs/architecture.md)
- [docs/workflow-rules.md](/Users/jviner/src/aigon/docs/workflow-rules.md)
- [feature-review-signalling-and-viewing.md](/Users/jviner/src/aigon/docs/specs/features/01-inbox/feature-review-signalling-and-viewing.md)
- [feature-seed-reset-rewrite.md](/Users/jviner/src/aigon/docs/specs/features/01-inbox/feature-seed-reset-rewrite.md)
