# Feature: refs-state-backend

## Summary
Update `aigon board` and the Aigon dashboard to read entity/claim state from git refs (`refs/aigon/*`) instead of `.aigon/` files, so team state is visible in both CLI and web UI.

## User Stories
- [ ] As a team member, I can see who has claimed what on `aigon board` via refs
- [ ] As a team member, I can see team claim state on the Aigon dashboard

## Acceptance Criteria
- [ ] `aigon board` reads entity anchors and claims from refs
- [ ] Dashboard displays claim/assignment state sourced from refs
- [ ] Falls back gracefully when refs are not configured (solo mode)

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
