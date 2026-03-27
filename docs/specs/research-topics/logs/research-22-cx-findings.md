# Research Findings: jira integration

**Agent:** Codex (cx)
**Research ID:** 22
**Date:** 2026-03-28

---

## Key Findings

### 1. Natural lifecycle mapping should be category-based, not status-name based

Aigon's current lifecycle is `inbox -> backlog -> in-progress -> in-evaluation -> done -> paused` for both features and research, with Fleet-specific gating handled separately via agent status and "all submitted" checks in [`lib/state-machine.js`](/Users/jviner/src/aigon/lib/state-machine.js). Jira workflows are project-specific and often have custom status names, so a hardcoded mapping to `"To Do"`, `"In Progress"`, or `"Done"` would be brittle. The stable abstraction is:

| Aigon stage | Jira mapping | Linear mapping | Notes |
|-------------|--------------|----------------|-------|
| `inbox` | To-do category status, usually triage/intake | Triage or Backlog | Tracker still owns intake queue semantics |
| `backlog` | To-do category status | Backlog | Safe default import/export state |
| `in-progress` | In-progress category status | Started / In Progress | Main execution phase |
| `in-evaluation` | Prefer dedicated review/QA status; otherwise stay in-progress and add an Aigon phase marker | Review-ish workflow state if the team has one; otherwise stay Started and add metadata | This phase is Aigon-specific and won't exist in every tracker workflow |
| `done` | Done category status | Completed / Done / Canceled depending close result | Keep explicit close reason if non-happy path |
| `paused` | Blocked / On Hold if present; otherwise unchanged status plus marker | Blocked / Canceled / custom paused state | Needs per-workspace config |

Recommendation: store tracker mappings as config keyed by tracker `statusId`/`workflowStateId`, with a fallback to Jira status category or Linear state type. Do not infer from display names alone.

### 2. Full bidirectional sync is too risky; use split ownership

Three models are possible:

| Model | Pros | Cons |
|-------|------|------|
| Tracker is source of truth | Fits enterprise reality; users stay in Jira/Linear | Aigon loses control of spec/eval/log artifacts and Fleet semantics |
| Aigon is source of truth | Clean internal model | Weak enterprise adoption because teams still live in Jira/Linear |
| Bidirectional sync | Best user experience when disciplined | High conflict risk if field ownership is not explicit |

The best fit is **bidirectional sync with field ownership**:

- Tracker owns: title, assignee, priority, labels, external status, due dates, reporter, team/project placement.
- Aigon owns: spec markdown, implementation logs, evaluation artifacts, agent statuses, Fleet topology, winner selection rationale.
- Shared but controlled: lifecycle stage, comments, linked artifacts.

That keeps the external tracker as the planning surface while preserving Aigon as the execution surface.

### 3. MVP should be import-first, then controlled outbound sync

Enterprise teams usually already have issues in Jira/Linear. The lowest-risk flow is:

1. Import existing issue into Aigon and create the local feature spec.
2. Persist tracker metadata in the feature manifest/spec frontmatter: tracker type, issue ID/key, project/team, mapped status IDs, last synced timestamp.
3. Write a remote link/comment back to the tracker pointing to the spec or dashboard context.
4. Sync Aigon state changes outward during `feature-start`, `feature-submit`, `feature-eval`, and `feature-close`.

Creating issues from Aigon should exist, but as a second step. If both directions are enabled on day one, conflict handling becomes the actual product before the integration itself works reliably.

### 4. Logs and evaluations should stay local; trackers should get compact summaries plus links

Jira supports issue comments, attachments, and remote issue links. Linear supports comments and attachments, including uploaded files referenced from issue/comment markdown. That makes both trackers good notification surfaces, but poor canonical stores for long multi-agent logs.

Recommendation:

- Keep full implementation logs, evaluation markdown, and findings in-repo.
- Post compact tracker comments at key milestones:
  - "Aigon started implementation"
  - "All agents submitted; evaluation ready"
  - "Winner selected: cx"
  - "Feature merged"
- Add a remote link or attachment back to the canonical artifact set.

This keeps trackers readable and avoids duplicating large markdown histories into systems that are optimized for discussion, not long-form artifact storage.

### 5. `requestTransition` should sync as an idempotent transition pipeline

Aigon already centralizes lifecycle transitions through the state machine. The tracker sync layer should hook into those transitions rather than letting tracker-specific code mutate state ad hoc.

Recommended flow:

1. Aigon command calls `requestTransition(...)`.
2. The transition is recorded locally first.
3. A tracker adapter resolves the mapped external status transition.
4. Adapter performs the external mutation.
5. Sync metadata stores `lastOutboundSyncAt`, `lastExternalRevision`, and error state.

For Jira this means using issue search/read APIs, then transition discovery plus transition execution. For Linear this means GraphQL mutations that update `stateId`, assignee, labels, or comments. Retries must be idempotent, because webhook echoes and CLI retries will happen in practice.

### 6. Fleet mode should not pretend trackers support multiple assignees

Jira and Linear both fundamentally center on one assignee per issue. Aigon Fleet has multiple agent participants and sometimes multiple candidate implementations. That does not map cleanly to the tracker's core assignee field.

Recommendation:

- Keep the human owner in the tracker `assignee`.
- Represent Fleet execution using labels/custom fields/comments:
  - `aigon`
  - `aigon:fleet`
  - `aigon-agents:cc,cx,gg,cu`
- Optionally create subtasks for each agent only if the team explicitly wants candidate tracking in the tracker UI.
- Winner selection should update the parent issue with a summary comment and optionally mark losing subtasks as canceled/abandoned.

This preserves tracker semantics instead of overloading assignee with agent IDs.

### 7. APIs required

#### Jira Cloud

- Issue create/update/read
- JQL issue search
- Status/transition discovery and transition execution
- Comments
- Attachments
- Remote issue links
- Webhooks
- Authentication via OAuth 2.0 (3LO) for real integrations, API token for local/headless bootstrap

#### Linear

- GraphQL issue query/mutation
- Workflow state lookup
- Comments
- Attachments / file storage
- Webhooks
- OAuth 2.0 authentication for multi-user integrations
- Personal API keys for local prototype flows
- Optional `actor=app` OAuth mode for service-account-style automation

### 8. Linear is similar enough for a generic adapter, but only at the capability layer

There is enough overlap to justify a generic `issue-tracker-adapter` abstraction if it is based on capabilities, not a fake universal schema.

Good shared capabilities:

- `findIssue`
- `createIssue`
- `updateIssueMetadata`
- `transitionIssue`
- `addComment`
- `linkArtifact`
- `registerWebhook`
- `normalizeExternalEvent`

Tracker-specific details must stay inside adapters:

- Jira uses REST and workflow transitions.
- Linear uses GraphQL and direct `stateId` mutation.
- Jira statuses are heavily customized by project.
- Linear workflow states are simpler but still workspace/team-specific.

### 9. MCP is useful, but not sufficient as the system-of-record sync backbone

As of March 28, 2026:

- Atlassian has an official remote MCP server (`atlassian/atlassian-mcp-server`) for Jira/Confluence workflows, with OAuth and optional API-token auth for headless setups.
- Linear has an official remote MCP server at `https://mcp.linear.app/mcp`, including Codex setup instructions and support for OAuth or bearer-token auth.

That makes MCP attractive for:

- interactive agent workflows
- manual research / triage
- low-code prototypes
- "use my existing tracker from the IDE" experiences

It is a weaker foundation for lifecycle sync because Aigon still needs:

- webhooks
- deterministic event handling
- conflict resolution
- sync metadata persistence
- explicit retries and reconciliation

Recommendation: support MCP as an optional execution transport for agent-driven operations, but build the real integration around direct APIs plus webhooks.

### 10. Conflict handling needs explicit policy, not "latest write wins"

Conflicts are unavoidable when someone changes Jira or Linear while Aigon is mid-run. The safest policy is ownership-aware reconciliation:

- If an externally owned field changes in Jira/Linear, pull it into Aigon.
- If an Aigon-owned artifact changes locally, never overwrite it from the tracker.
- If lifecycle state changes externally while Aigon is active, mark the sync record as conflicted and require user confirmation before Aigon performs its next transition.
- If the external issue is moved to Done while Aigon is still implementing, stop outbound transitions and prompt the user to either close locally or reopen externally.

This should be backed by webhook ingestion plus periodic reconciliation, because webhook delivery is not a substitute for eventual consistency checks.

## Sources

- Aigon state model: `lib/state-machine.js`
- Jira REST API v3 intro: https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/
- Jira issues API: https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/
- Jira issue search / JQL API: https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/
- Jira webhooks: https://developer.atlassian.com/cloud/jira/platform/webhooks/
- Jira basic auth and API tokens: https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/
- Jira OAuth 2.0 (3LO) apps: https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/
- Linear API docs root: https://developers.linear.app/docs
- Linear MCP server: https://linear.app/docs/mcp
- Linear developers docs: attachments and API guides surfaced from https://linear.app/developers/
- Linear OAuth actor authorization: https://linear.app/developers/oauth-actor-authorization
- Atlassian official MCP server repo: https://github.com/atlassian/atlassian-mcp-server

## Recommendation

Build this in four layers:

1. **Tracker adapter core**
   Define a capability-based adapter contract and sync metadata model. This is the architectural foundation.

2. **Jira Cloud adapter first**
   Ship import-first Jira support with outbound status/comment/link sync. Use OAuth 2.0 (3LO) for team use and API-token auth only for local or headless bootstrap.

3. **Webhook + reconciliation loop**
   Add inbound sync for externally owned fields and conflict detection. Do not attempt open-ended bidirectional markdown syncing.

4. **Linear adapter second**
   Reuse the adapter core, but implement GraphQL- and `stateId`-specific behavior behind the same capability interface.

The MVP should be:

- import Jira issue -> create local Aigon spec
- persist external issue metadata locally
- sync `feature-start`, `feature-submit`, `feature-eval`, `feature-close` outward
- post concise tracker comments with links to Aigon artifacts
- ingest webhooks for status/assignee/title updates
- block or warn on conflicting lifecycle moves

I would **not** make MCP the primary implementation path. I would expose MCP-backed commands later as an optional convenience layer once the direct sync path is reliable.

## Suggested Features

<!--
Use the table format below. Guidelines:
- feature-name: Use kebab-case, be specific (e.g., "user-auth-jwt" not "authentication")
- description: One sentence explaining the capability
- priority: high (must-have), medium (should-have), low (nice-to-have)
- depends-on: Other feature names this depends on, or "none"
-->

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| issue-tracker-adapter-core | Add a capability-based adapter layer and sync metadata model for external issue trackers. | high | none |
| jira-cloud-import-and-link | Import Jira issues into Aigon specs and persist issue keys, status mappings, and artifact links. | high | issue-tracker-adapter-core |
| jira-outbound-lifecycle-sync | Sync Aigon lifecycle transitions, comments, and winner/close summaries back to Jira Cloud. | high | jira-cloud-import-and-link |
| tracker-webhook-reconciliation | Ingest external webhook events and reconcile externally owned field changes with conflict detection. | high | issue-tracker-adapter-core |
| tracker-conflict-resolution-ui | Surface conflicting lifecycle or metadata changes in the dashboard and require explicit user resolution. | medium | tracker-webhook-reconciliation |
| linear-adapter | Implement the same adapter contract for Linear using GraphQL, workflow states, comments, and webhook events. | medium | issue-tracker-adapter-core |
| tracker-artifact-linking | Publish stable links from Jira/Linear comments or attachments to local specs, logs, and evaluations. | medium | issue-tracker-adapter-core |
| mcp-tracker-operations | Add optional MCP-backed tracker actions for interactive agent workflows without making MCP the sync backbone. | low | issue-tracker-adapter-core |
