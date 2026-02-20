# Feature: feedback-triage-workflow

## Summary

Add an MVP feedback workflow to Aigon: create feedback items with attribution, list/filter them for triage, and run an AI-assisted triage loop (classification + dedupe suggestions) with explicit human confirmation.

## User Stories
<!-- Specific, stories describing what the user is trying to acheive -->
- [ ] As a developer, I want to quickly record feedback from a user (with source + reporter) so it enters a structured intake lane.
- [ ] As a product triager, I want to classify + tag feedback and identify duplicates so I can route it into action.
- [ ] As a team lead, I want to list/filter feedback items by status/severity/type so I can focus on what matters.

## Acceptance Criteria
<!-- Specific, testable criteria that define "done" -->
- [ ] `aigon feedback-create "<title>"` creates a new feedback doc in `docs/specs/feedback/01-inbox/` using the shared template and assigns the next available ID.
- [ ] `aigon feedback-list` prints a readable list of feedback items and supports filtering by at least:
  - status folder (`--inbox`, `--triaged`, `--actionable`, `--done`, `--wont-fix`, `--duplicate`, `--all`)
  - `--type` and `--severity` (when present)
  - `--tag` (when present)
- [ ] `aigon feedback-triage <ID>` supports a triage loop that results in:
  - updated YAML front matter fields (`type`, `severity`, `tags`, `status`, `duplicate_of` when applicable)
  - moving the file to the correct lifecycle folder
- [ ] AI assistance is available for triage (via an agent command prompt template) to:
  - propose `type`, `severity`, and tags
  - propose duplicate candidates by comparing against existing feedback items (title + summary)
  - recommend next action (keep, mark duplicate, promote to feature, promote to research, wont-fix)
  - require explicit user confirmation before applying changes

## Technical Approach
<!-- High-level approach, key decisions, constraints, non-functional requirements -->

- Implement `feedback-create`, `feedback-list`, `feedback-triage` in `aigon-cli.js` (file-based operations: create, scan, update front matter, move files).
- Add agent prompt templates under `templates/generic/commands/`:
  - `feedback-triage.md` (AI-assisted decision support)
  - optionally `feedback-create.md` and `feedback-list.md` for consistent agent UX
- Include these commands in agent configs so `aigon install-agent ...` installs them for cc/gg/cx/cu.

## Dependencies
<!-- Other features, external services, or prerequisites -->
- `feedback-foundation`

## Out of Scope
<!-- Explicitly list what this feature does NOT include -->
- Promotion into features/research and bidirectional linking (handled by `feedback-promote-traceability`)
- Batch import from external sources
- Formal scoring policy / SLA system

## Open Questions
<!-- Unresolved questions that may need clarification during implementation -->
- Should `feedback-triage` be primarily interactive (CLI prompts) or primarily agent-driven (template-driven) for the first version?
- How aggressively should we attempt duplicate detection without embeddings/a database (e.g. title-only vs title+body)?

## Related
<!-- Links to research topics, other features, or external docs -->
- Research: `docs/specs/research-topics/03-in-progress/research-04-explore-feedback.md`
