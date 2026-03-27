# Feature: jira-integration-foundation

## Summary

Build the foundational layer for external issue tracker integration: a generic `IssueTrackerAdapter` interface, the Jira Cloud REST API v3 adapter, config commands for Jira credentials/settings, and import/link commands to connect Aigon features to existing Jira issues. This is the architectural base that all other Jira features and the Linear adapter build on.

## User Stories

- [ ] As a developer, I can run `aigon config set jira.url https://myteam.atlassian.net` (+ email, token, project key) to configure Jira credentials
- [ ] As a developer, I can run `aigon jira-link <feature-id> <PROJ-123>` to connect an Aigon feature to an existing Jira issue
- [ ] As a developer, I can run `aigon jira-import <PROJ-123>` to create an Aigon feature spec from an existing Jira issue
- [ ] As a developer, I can see the linked Jira issue key in the feature manifest and dashboard

## Acceptance Criteria

- [ ] `lib/adapters/issue-tracker.js` defines a capability-based adapter interface (connect, createIssue, getIssue, updateIssue, transitionTo, addComment, searchIssues, getStatuses, getValidTransitions)
- [ ] `lib/adapters/jira.js` implements the adapter for Jira Cloud REST API v3 with API token auth (Basic auth: email + token)
- [ ] Jira adapter handles: transition discovery (GET transitions before executing), ADF comment formatting, rate limiting (Retry-After + backoff on 429), pagination
- [ ] Config stored in `~/.aigon/config.json` (credentials) and `.aigon/config.json` (project: URL, projectKey, statusMapping overrides)
- [ ] `aigon jira-link` stores `{ externalIssue: { provider: "jira", key: "PROJ-123", cloudId: "..." } }` in the feature manifest
- [ ] `aigon jira-import` fetches Jira issue details and creates a local feature spec with title, description, and backlink
- [ ] Status mapping is category-based by default (not hardcoded names) with per-project overrides via config
- [ ] `node -c lib/adapters/jira.js && node -c lib/adapters/issue-tracker.js` passes

## Validation

```bash
node -c lib/adapters/issue-tracker.js && node -c lib/adapters/jira.js
```

## Technical Approach

- Adapter interface is capability-based (not a universal schema) — tracker-specific details stay inside adapters
- Jira REST API v3: transitions are constrained (must discover valid moves), comments require ADF format, webhooks require OAuth (API tokens sufficient for MVP)
- Auth: API tokens for MVP (email + token in Basic auth header), stored in global config or `$AIGON_JIRA_TOKEN` env var
- Status mapping: keyed by Jira status category (To Do, In Progress, Done) with configurable overrides per status name
- Sync metadata in manifest: `externalIssue`, `lastSyncedAt`, `externalStatus`

## Dependencies

- none

## Out of Scope

- Outbound status sync (see: jira-lifecycle-sync)
- Bidirectional sync / webhooks (see: tracker-webhook-conflict)
- Linear support (see: linear-adapter)
- Jira Server/Data Center (Cloud only for MVP)
- OAuth 2.0 auth (API tokens only for MVP)

## Open Questions

- Should `jira-import` auto-create the status mapping config if the project's Jira workflow doesn't match defaults?
- How to handle Jira issues with custom issue types (bugs, stories, epics) — map all to Aigon features?

## Related

- Research: #22 jira-integration
