# Feature: stale-claim-recovery

## Summary
Force-claim mechanism for recovering from crashed or abandoned agents. Allows a team member to take over a stale claim using `--force` with an audit trail in the claim metadata.

## User Stories
- [ ] As a team member, I can force-claim a feature that was abandoned by a crashed agent
- [ ] As a team lead, I can see in the audit trail who force-claimed and when

## Acceptance Criteria
- [ ] `aigon claim --force <id>` overwrites an existing claim ref
- [ ] Force-claim records previous owner and reason in claim metadata
- [ ] Normal (non-force) claim still fails if already claimed

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
