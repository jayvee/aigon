# Feature: workflow-stages-v2

## Summary
Extend the workflow schema from flat parameter bundles (v1) to ordered multi-stage pipelines. A `stages` array replaces the flat `agents`/`stopAfter`/`reviewAgent`/`evalAgent` fields, enabling workflows like implement → review → counter-review → close. v1 flat-format workflows remain valid forever (no migration needed).

## User Stories
- [ ] As a user with a multi-round process (implement, review, counter-review, re-implement), I can define this as a single workflow instead of manually orchestrating each phase
- [ ] As a user with existing v1 workflows, they continue working without any migration

## Acceptance Criteria
- [ ] Workflow schema supports a `stages` array with ordered steps
- [ ] Each stage defines `type` (implement, review, eval, close, etc.) and associated agents
- [ ] v1 flat-format workflows (no `stages` key) continue to work unchanged
- [ ] `version: 2` in schema indicates stage-based format
- [ ] Validation rejects invalid stage orderings

## Validation
```bash
node -c aigon-cli.js
npm test
```

## Technical Approach
- Schema v2 adds `stages` array following the Buildkite model (ordered step list with implicit barriers)
- Engine checks for `stages` array; if absent, uses v1 flat fields
- Stage types: `implement`, `review`, `eval`, `counter-review`, `close` (extensible to `notify`, `deploy`, `open-pr` later)
- Requires multi-round execution support in the AutoConductor — this is the real prerequisite

## Dependencies
- depends_on: workflow-definitions

## Out of Scope
- DAG execution (keep it linear/ordered)
- Conditional branching between stages
- Workflow inheritance or composition
- External system integrations (deploy, notify) — noted as future stage types only

## Open Questions
- Does multi-round execution need to ship first as its own feature before this schema is useful?

## Related
- Research: #29 workflow-templates
