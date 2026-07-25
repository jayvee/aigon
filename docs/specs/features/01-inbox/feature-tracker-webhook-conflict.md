# Feature: tracker-webhook-conflict

## Summary

Add inbound sync from external issue trackers via webhooks (or polling fallback), with ownership-aware conflict detection and resolution. When someone changes a Jira/Linear issue while Aigon is mid-implementation, surface the conflict in the dashboard and require explicit user resolution instead of silently overwriting.

## User Stories

- [ ] As a developer, when a PM moves a Jira issue to "On Hold" while Aigon is implementing, I see a conflict notification in the dashboard
- [ ] As a developer, I can resolve conflicts explicitly: accept external change, keep Aigon state, or force-sync
- [ ] As a developer, externally-owned fields (title, assignee, priority, labels) auto-sync from the tracker without conflicts
- [ ] As a developer, I can run `aigon tracker-sync <feature-id>` to manually reconcile a feature with its linked issue

## Acceptance Criteria

- [ ] Webhook receiver endpoint (via AIGON server or standalone) accepts Jira webhook events (issue_updated) and Linear webhook events
- [ ] Jira webhook signature verification (or manual registration guidance, since API token auth can't register webhooks programmatically)
- [ ] Linear webhook HMAC-SHA256 signature verification
- [ ] Field ownership model: tracker owns title/assignee/priority/labels/due dates; Aigon owns specs/logs/evaluation/agent status
- [ ] Externally-owned field changes sync automatically (pull into manifest/spec)
- [ ] Lifecycle conflicts detected: if external status changes while Aigon is active, mark sync record as `conflicted`
- [ ] Conflicted features shown in dashboard with resolution options
- [ ] Periodic reconciliation check (polling fallback) for environments without webhook access
- [ ] Sync loop prevention: ignore webhook events triggered by Aigon's own outbound pushes (via `lastOutboundSyncAt` comparison or event source marker)

## Validation

```bash
node -c aigon-cli.js
```

## Technical Approach

- Ownership-aware reconciliation (CX's model): split fields into tracker-owned vs Aigon-owned, only conflict on shared lifecycle state
- Webhook endpoint on AIGON server (existing HTTP infrastructure), new route for each tracker
- Polling fallback: `aigon tracker-sync` command + optional cron-style periodic check
- Conflict state stored in manifest: `{ sync: { status: "conflicted", externalStatus: "On Hold", aigonStage: "in-progress", detectedAt: "..." } }`
- Resolution: `aigon tracker-resolve <feature-id> --accept-external | --keep-aigon | --force-sync`

## Dependencies

- depends_on: jira-lifecycle-sync

## Out of Scope

- Full bidirectional markdown content sync (specs, logs)
- Automatic conflict resolution (always requires user input for lifecycle conflicts)

## Open Questions

- Should webhook receiver be part of the AIGON server or a separate process?
- For teams without webhook access (firewalls), what polling interval is reasonable? (5 min? 15 min?)
- Should Jira OAuth be required for this feature (webhook registration) or support manual webhook setup via admin UI?

## Related

- Research: #22 jira-integration
