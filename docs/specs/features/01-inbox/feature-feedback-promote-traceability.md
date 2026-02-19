# Feature: feedback-promote-traceability

## Summary

Allow teams to convert actionable feedback into work items without losing provenance by adding a `feedback-promote` command and enforcing **bidirectional traceability** between feedback items and the research topics / feature specs they create or link to.

## User Stories
<!-- Specific, stories describing what the user is trying to acheive -->
- [ ] As a product owner, I want to promote feedback into a feature spec or research topic so it enters the existing Aigon delivery workflow.
- [ ] As a developer, I want every promoted feature/research doc to link back to its motivating feedback so the “why” is preserved.
- [ ] As a triager, I want feedback to reflect what it produced (or was merged into) so I can close the loop.

## Acceptance Criteria
<!-- Specific, testable criteria that define "done" -->
- [ ] `aigon feedback-promote <ID>` supports promoting a feedback item into either:
  - a new feature spec (created in `docs/specs/features/01-inbox/`), or
  - a new research topic (created in `docs/specs/research-topics/01-inbox/`), or
  - linking to an existing feature/research item (no new file)
- [ ] Promotion/linking updates traceability in both directions:
  - feedback front matter appends to `linked_features` / `linked_research`
  - feature/research docs add a backlink to the feedback item in their `## Related` section (or another consistent, documented location)
- [ ] `feedback-promote` is idempotent: re-running does not create duplicate links or duplicate files.
- [ ] When feedback is promoted, the feedback item moves to an appropriate lifecycle folder (at least `03-actionable/`), unless the user chooses to keep it in its current state.

## Technical Approach
<!-- High-level approach, key decisions, constraints, non-functional requirements -->

- Implement `feedback-promote` in `aigon-cli.js`:
  - create downstream docs by calling the existing create helpers (feature/research create) or directly writing templates
  - update YAML front matter in feedback docs
  - update downstream docs by appending a stable backlink under `## Related`
- Add an agent prompt template `templates/generic/commands/feedback-promote.md` to guide an AI-assisted promote decision (feature vs research vs duplicate).

## Dependencies
<!-- Other features, external services, or prerequisites -->
- `feedback-triage-workflow`

## Out of Scope
<!-- Explicitly list what this feature does NOT include -->
- Automatically notifying users (“closing the loop”) via external systems
- Public voting portals or discussion threads
- Importing feedback from third-party tools

## Open Questions
<!-- Unresolved questions that may need clarification during implementation -->
- Where should backlinks live in downstream docs (extend existing `## Related` section vs introduce YAML front matter)?
- Should `feedback-promote` be allowed before triage is complete, or require `status` ≥ `triaged`?

## Related
<!-- Links to research topics, other features, or external docs -->
- Research: `docs/specs/research-topics/03-in-progress/research-04-explore-feedback.md`
