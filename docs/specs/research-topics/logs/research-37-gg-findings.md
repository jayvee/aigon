# Research Findings: state machine review cycle redesign

**Agent:** Gemini (gg)
**Research ID:** 37
**Date:** 2026-04-24

---

## Key Findings

### Spec Review Implementation
- **Data Structure**: `specReview` context property in `FeatureContext` / `ResearchContext`.
- **Projection**: `lib/workflow-core/projector.js` calculates `specReview` using `buildSpecReviewSummary` from `lib/spec-review-state.js`.
- **Events**: `spec_review.started`, `spec_review.check_started`, `spec_review.submitted`, `spec_review.acked`.
- **Engine State**: Currently bypasses the XState machine (`bypassMachine: true` in action candidates).
- **Dashboard**: Bespoke rendering in `workflow-read-model.js` via `readSpecReviewSessions` and `readSpecCheckSessions`.

### Engine States
- Defined in `lib/feature-workflow-rules.js` and `lib/research-workflow-rules.js`.
- Initialized in `lib/workflow-core/machine.js` using `hydrating` transient state and `isImplementing` type guards.
- Current states: `hydrating`, `implementing`, `paused`, `reviewing`, `evaluating`, `ready_for_review`, `closing`, `done`.

### Owning Agent
- `authorAgentId` exists in engine context but is not yet exposed in spec frontmatter.
- `feature-create` and `research-create` do not write `agent:` to frontmatter.
- `feature-start` and `research-start` do not respect an `agent:` default.

## Sources

- `lib/workflow-core/machine.js`: XState machine definition.
- `lib/feature-workflow-rules.js`: Feature-specific workflow rules and engine states.
- `lib/workflow-core/projector.js`: Event projection logic.
- `lib/spec-review-state.js`: Spec review status calculation.
- `lib/dashboard-status-collector.js`: Dashboard data collection logic.
- `lib/entity.js`: Entity creation and prioritisation logic.

## Recommendation

1.  **Engine States**: Promote spec review and code review cycles to first-class engine states in `FEATURE_ENGINE_STATES`.
2.  **Internal Transient States**: Use `always` transitions in `machine.js` for `*_complete` states to automatically move forward when criteria (like `pendingCount === 0`) are met.
3.  **Action Promotion**: Remove `bypassMachine: true` from spec review actions and define them as machine events.
4.  **Data-Driven Dashboard**: Simplify dashboard collection by relying on the unified snapshot state and `validActions` array.
5.  **Owning Agent**: Implement `agent:` frontmatter field in templates and creation/start logic.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| promote-spec-review-states | Add spec_review and spec_revision states to engine | high | none |
| promote-code-review-states | Add code_review and code_revision states to engine | high | none |
| data-driven-dashboard | Eliminate bespoke specReview rendering in favor of unified snapshot state | medium | promote-spec-review-states |
| spec-owning-agent | Add agent: frontmatter field and integrate with create/start commands | low | none |
| review-cycle-loop | Implement loop-back from revision to review with agent picker | medium | promote-code-review-states |
