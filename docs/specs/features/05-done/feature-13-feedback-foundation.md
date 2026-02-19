# Feature: feedback-foundation

## Summary

Introduce a first-class, file-based **Feedback** entity in Aigon (`docs/specs/feedback/`) so teams can capture raw user/customer input (with attribution + provenance) and triage it into actionable research topics and feature specs without polluting the curated feature/research backlogs.

## User Stories
<!-- Specific, stories describing what the user is trying to acheive -->
- [ ] As a developer, I want a standard place + schema to store feedback so it is searchable and consistently triageable.
- [ ] As a product owner, I want feedback to carry attribution + provenance (who/where/when) so I can close the loop.

## Acceptance Criteria
<!-- Specific, testable criteria that define "done" -->
- [ ] `aigon init` creates `docs/specs/feedback/` with lifecycle folders:
  - `01-inbox/`, `02-triaged/`, `03-actionable/`, `04-done/`, `05-wont-fix/`, `06-duplicate/` (optional but recommended)
- [ ] Feedback items are Markdown files stored under these folders with filenames following: `feedback-<ID>-<slug>.md` (ID is numeric and stable once assigned).
- [ ] Feedback items use YAML front matter with a documented schema:
  - required: `id`, `title`, `status`, `type`, `reporter`, `source`
  - optional: `severity`, `tags`, `votes`, `duplicate_of`, `linked_features`, `linked_research`
- [ ] A template exists for new feedback items (so `feedback-create` can generate consistent docs).
- [ ] The schema is system-agnostic: it supports optional `source.url`, but does not require/assume Jira/Linear/etc.

## Technical Approach
<!-- High-level approach, key decisions, constraints, non-functional requirements -->

- Extend `PATHS` in `aigon-cli.js` with a new `feedback` entry (root + lifecycle folders + filename prefix).
- Add a feedback template under `templates/specs/` (e.g. `templates/specs/feedback-template.md`) and keep any user-facing copy under `docs/specs/templates/` if needed.
- Keep the “status” concept aligned with folder placement (CLI moves files between folders and updates `status` in front matter).

## Dependencies
<!-- Other features, external services, or prerequisites -->
- none

## Out of Scope
<!-- Explicitly list what this feature does NOT include -->
- CLI workflow commands (`feedback-create`, `feedback-triage`, `feedback-list`, `feedback-promote`)
- External tool integrations (Jira/Linear/Intercom/etc.)
- Prioritization frameworks and scoring policy

## Open Questions
<!-- Unresolved questions that may need clarification during implementation -->
- Should feedback IDs be 2-digit (consistent with existing helpers) or 4+ digits (more realistic volume)?
- Do we want `06-duplicate/` as a folder, or handle duplicates via `duplicate_of` only?

## Related
<!-- Links to research topics, other features, or external docs -->
- Research: `docs/specs/research-topics/03-in-progress/research-04-explore-feedback.md`
