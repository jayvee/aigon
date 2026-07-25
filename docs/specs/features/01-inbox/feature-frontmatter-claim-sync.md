# Feature: frontmatter-claim-sync

## Summary
After an atomic ref-based claim succeeds, update the spec file's YAML frontmatter with `assignee`, `claimed_at`, and `claimed_by` fields so humans can see attribution when reading the markdown directly (editor, GitHub file browser, PR diffs).

## User Stories
- [ ] As a developer reading a spec file, I can see who claimed this feature without running CLI commands

## Acceptance Criteria
- [ ] Successful claim updates spec frontmatter with assignee info
- [ ] Frontmatter is treated as a cache — refs remain the source of truth
- [ ] Release/abandon removes or clears frontmatter assignee

## Validation
<!-- Optional: commands the iterate loop runs after each iteration (in addition to project-level validation).
     Use for feature-specific checks that don't fit in the general test suite.
     All commands must exit 0 for the iteration to be considered successful.
-->
```bash
# Example: node --check aigon-cli.js
```

## Technical Approach
<!-- High-level approach, key decisions, constraints, non-functional requirements -->

## Dependencies
<!-- Other features, external services, or prerequisites.
     For Aigon feature dependencies use: depends_on: feature-name-slug
     This enables ordering enforcement — dependent features can't start until deps are done. -->
- depends_on: git-native-team-sync

## Out of Scope
<!-- Explicitly list what this feature does NOT include -->
-

## Open Questions
<!-- Unresolved questions that may need clarification during implementation -->
-

## Related
<!-- Links to research topics, other features, or external docs -->
- Research: #24 git-native-team-sync-architecture
