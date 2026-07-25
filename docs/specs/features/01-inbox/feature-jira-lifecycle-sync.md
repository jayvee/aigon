# Feature: jira-lifecycle-sync

## Summary

Automatically sync Aigon feature lifecycle events to linked Jira issues: push status transitions when Aigon state changes, post compact milestone comments at key points (started, submitted, evaluated, closed), and support creating features in both Aigon and Jira simultaneously via `--jira` flag. This gives enterprise PMs visibility in Jira without disrupting the developer's Aigon workflow.

## User Stories

- [ ] As a developer, when I run `aigon feature-start` on a Jira-linked feature, the Jira issue automatically transitions to "In Progress"
- [ ] As a PM, I can see milestone comments on the Jira issue when agents start, submit, and complete work
- [ ] As a developer, I can run `aigon feature-create "name" --jira` to create a feature in both Aigon and Jira simultaneously
- [ ] As a developer, when I run `aigon feature-close`, the Jira issue transitions to "Done" with a summary comment

## Acceptance Criteria

- [ ] `requestTransition` in state machine triggers outbound Jira status push for linked features (via side-effect or outbox)
- [ ] Status push discovers valid Jira transitions first, then executes the appropriate one based on status mapping
- [ ] Milestone comments posted at: feature-start, feature-submit (per agent in Fleet), feature-eval (winner selected), feature-close
- [ ] Comments are concise (1-3 sentences) with links to Aigon dashboard/artifacts — not verbose agent logs
- [ ] Comments use ADF format (Jira v3 requirement) — helper converts markdown snippets to ADF
- [ ] `aigon feature-create "name" --jira` creates both local spec and Jira issue, links them in manifest
- [ ] If Jira API is unreachable, sync fails gracefully (logged warning, not blocking) — Aigon continues working
- [ ] Sync metadata updated: `lastOutboundSyncAt`, `lastExternalStatus` in manifest

## Validation

```bash
node -c lib/adapters/jira.js && node -c aigon-cli.js
```

## Technical Approach

- Hook into `requestTransition()` — after local state change succeeds, attempt outbound sync as a side-effect
- Transition push: call `GET /rest/api/3/issue/{key}/transitions` to discover valid moves, then `POST` the matching transition
- ADF helper: small utility to wrap markdown text in Atlassian Document Format JSON structure for comments
- `--jira` flag on `feature-create`: calls adapter `createIssue()` then stores link in manifest
- Graceful degradation: wrap all Jira API calls in try/catch, log failures, don't block local operations

## Dependencies

- depends_on: jira-integration-foundation

## Out of Scope

- Inbound sync from Jira (see: tracker-webhook-conflict)
- Fleet sub-task creation in Jira (deferred — low priority from research)
- Syncing implementation logs or evaluation artifacts as attachments

## Open Questions

- Should sync failures be retried automatically (outbox pattern) or just logged for manual retry?
- Should `feature-pause` also sync to Jira? (requires custom "On Hold" status which may not exist)

## Related

- Research: #22 jira-integration
