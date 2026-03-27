# Feature: linear-adapter

## Summary

Implement the `IssueTrackerAdapter` interface for Linear using its GraphQL API and `@linear/sdk`. Supports the same workflows as the Jira adapter — import issues, link features, push status transitions, and post milestone comments — but with Linear's simpler model (no transition constraints, markdown-native comments, direct state mutations).

## User Stories

- [ ] As a developer using Linear, I can run `aigon config set linear.apiKey lin_api_...` to configure Linear credentials
- [ ] As a developer, I can run `aigon linear-link <feature-id> <LIN-123>` to connect an Aigon feature to a Linear issue
- [ ] As a developer, I can run `aigon linear-import <LIN-123>` to create an Aigon feature from an existing Linear issue
- [ ] As a developer, Aigon lifecycle transitions automatically update the linked Linear issue state and post milestone comments

## Acceptance Criteria

- [ ] `lib/adapters/linear.js` implements the `IssueTrackerAdapter` interface using `@linear/sdk`
- [ ] Auth: personal API key stored in `~/.aigon/config.json` or `$AIGON_LINEAR_KEY` env var
- [ ] Status transitions use direct `issueUpdate(stateId)` — no transition discovery needed (unlike Jira)
- [ ] Comments use markdown directly (no ADF conversion needed)
- [ ] Workflow states are team-scoped — adapter looks up states by team + type (backlog, unstarted, started, completed)
- [ ] Import creates local spec from Linear issue (title, description, labels, assignee)
- [ ] Config: `linear.teamId`, `linear.statusMapping` overrides in `.aigon/config.json`
- [ ] Rate limiting: respect 1,500 req/hour limit with complexity-based backoff
- [ ] `node -c lib/adapters/linear.js` passes

## Validation

```bash
node -c lib/adapters/linear.js
```

## Technical Approach

- Use `@linear/sdk` (official TypeScript SDK) which wraps the GraphQL API with typed methods
- State mapping by type: `backlog`→inbox/backlog, `unstarted`→backlog, `started`→in-progress/in-evaluation, `completed`→done
- Single assignee field — map to human owner, not agents
- Webhook support (HMAC-SHA256 verification) can be wired into tracker-webhook-conflict feature later

## Dependencies

- depends_on: jira-integration-foundation (for the adapter interface)

## Out of Scope

- Webhook ingestion (see: tracker-webhook-conflict)
- OAuth 2.0 for multi-user (API key only for MVP)

## Open Questions

- Should `linear-link` and `jira-link` be unified into a single `aigon tracker-link` command, or keep them separate?

## Related

- Research: #22 jira-integration
