# Feature: git-native-team-sync

## Summary
Refs-based team sync: implement `refs/aigon/*` namespace for entity anchors, atomic claim workflow (fetch-check-claim-push with conflict detection), and refspec auto-configuration via `aigon init --team`. Replaces paused features 250-253.

## User Stories
- [ ] As a team member, I can run `aigon init --team` to configure my clone for team sync (refspecs, log.excludeDecoration, notes merge strategy)
- [ ] As a team member, I can claim a feature/research atomically so no two people start the same work
- [ ] As a team member, I can see who has claimed what via `aigon sync status`

## Acceptance Criteria
- [ ] `refs/aigon/features/<id>` and `refs/aigon/research/<id>` anchor refs created during prioritisation
- [ ] Atomic claim via ref push with non-fast-forward rejection on conflict
- [ ] `aigon init --team` configures fetch refspecs, log.excludeDecoration, and notes merge strategy
- [ ] Works on bare git and GitHub; GitLab best-effort; Bitbucket not required for v1

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
-

## Out of Scope
<!-- Explicitly list what this feature does NOT include -->
-

## Open Questions
<!-- Unresolved questions that may need clarification during implementation -->
-

## Related
<!-- Links to research topics, other features, or external docs -->
- Research: #24 git-native-team-sync-architecture
