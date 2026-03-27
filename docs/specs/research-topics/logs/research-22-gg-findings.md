## Research Findings: Jira Integration

This document outlines the findings for integrating Aigon with Jira.

### Q1: Aigon State to Jira Status Mapping

Aigon's feature lifecycle can be mapped to standard Jira workflow statuses. Given Jira workflows are customizable, the integration should allow for a configurable mapping. A sensible default would be:

| Aigon State     | Jira Status Category | Default Jira Status | Notes                                           |
| :-------------- | :------------------- | :------------------ | :---------------------------------------------- |
| `inbox`         | `To Do`              | `TO DO` / `OPEN`    | New features not yet prioritized.               |
| `backlog`       | `To Do`              | `BACKLOG`           | Prioritized features ready for work.            |
| `in-progress`   | `In Progress`        | `IN PROGRESS`       | Active development by Aigon agents.             |
| `in-evaluation` | `In Progress`        | `IN REVIEW` / `QA`  | Agent submissions are being evaluated.          |
| `done`          | `Done`               | `DONE`              | Feature is complete and accepted.               |
| `paused`        | `To Do`              | `ON HOLD`           | Work is temporarily stopped.                    |


### Q2: Source of Truth and Sync Strategy

- **Jira as Source of Truth:** Simple for Aigon, but loses Aigon's detailed state. Unwieldy, as all Aigon metadata would need to be stored in custom Jira fields.
- **Aigon as Source of Truth:** Preserves Aigon's model, but forces users away from familiar Jira workflows.
- **Bidirectional Sync:** The best UX, but the most complex to implement due to potential race conditions and conflict resolution.

**Recommendation:** A phased approach.
1.  **MVP:** One-way sync. Features are created in Jira. A new `aigon feature-import --jira <ID>` command creates the local spec. Aigon then pushes status updates and results back to Jira. This prevents conflicts and aligns with enterprise workflows where Jira is the system of record.
2.  **V2:** Full bidirectional sync, using webhooks for real-time updates from Jira to Aigon. This requires robust conflict resolution logic.

### Q3: Feature Creation Workflow

Both push and pull models are valuable.
- **Pull from Jira (more important for enterprise):** `aigon feature-import --jira=PROJ-123` fetches the issue and creates a local spec file.
- **Push from Aigon:** `aigon feature-create "name" --push-to-jira` creates a local spec and a corresponding Jira issue.

### Q4: Implementation Log Storage

Jira comments are not suitable for verbose, streaming agent logs.

**Recommendation:** A hybrid approach.
1.  On `feature-start`, Aigon posts a comment to the Jira issue: "Aigon is starting work. Track live progress here: [link to Aigon dashboard]".
2.  Agent logs and ephemeral artifacts remain within Aigon's ecosystem.
3.  On `feature-close`, Aigon posts a final summary comment to Jira, and attaches key artifacts (e.g., the winning diff, a summary of the evaluation) to the issue. For more detailed documentation, a Confluence page could be created and linked.

### Q5: Syncing State Transitions

- **Aigon -> Jira:** Aigon's `requestTransition` function should be extended to make a corresponding Jira API call to change the issue status. This requires a configurable mapping of Aigon stages to Jira status IDs.
- **Jira -> Aigon:** This requires a Jira webhook that calls an Aigon-hosted endpoint. The endpoint would authenticate the request and then execute the corresponding Aigon command (e.g., `aigon feature-pause 123`). This is a V2 feature due to the complexity of setting up and securing webhooks.

### Q6: Mapping Agents and Fleet Mode

- **Sub-tasks:** This is the most robust model. The parent Jira issue represents the feature. When Aigon starts work in Fleet mode, it creates a sub-task for each agent. The agent's work is associated with their sub-task. The parent issue is only resolved when a winning sub-task is promoted.
- **Assignees:** Aigon agents (`cc`, `gg`, etc.) could be mapped to real Jira users.
- **Labels:** Useful for status metadata, like `aigon-fleet`, `winner-cc`.

### Q7: Required Jira APIs

- **Jira Cloud REST API v3:** The primary API for interacting with issues, transitions, and comments.
- **Webhooks:** For real-time Jira -> Aigon sync (V2). Aigon would need to subscribe to `issue_updated` and `issue_created` events.
- **JQL (Jira Query Language):** For searching and filtering issues (e.g., `aigon feature-import`).

### Q8: Reflecting Evaluation Results in Jira

- The winning agent's sub-task is transitioned to `Done`.
- Losing agents' sub-tasks are transitioned to `Closed` or `Won't Do`.
- A comment is added to the parent issue: "Evaluation complete. Agent 'cc' was selected as the winner."
- The diff from the winning agent could be added as an attachment or comment.

### Q9: Authentication Model

- **OAuth 2.0 (3LO):** The most secure and scalable method. It allows Aigon to act on behalf of a user. This is complex to set up.
- **API Tokens:** Simpler. A user generates an API token from their Atlassian account and configures it in Aigon. This is less secure as the token is long-lived and has the full permissions of the user. It's a good starting point for a single-user or trusted environment.
- **Service Account:** A dedicated "Aigon" user in Jira. All actions are performed by this user. This is the simplest model for system-level integration.

**Recommendation:** Start with API tokens stored in Aigon's configuration, tied to a service account. Graduate to OAuth for per-user authentication in a future version.

### Q10: Generalizing for Linear (Adapter Pattern)

Yes, there is enough commonality. Both Jira and Linear have concepts of issues/tickets, statuses, assignees, and comments. Aigon should define a generic `IssueTracker` interface (adapter pattern).

```javascript
interface IssueTracker {
  importIssue(id: string): Promise<FeatureSpec>;
  createIssue(spec: FeatureSpec): Promise<string>;
  updateStatus(id: string, newStatus: string): Promise<void>;
  addComment(id: string, comment: string): Promise<void>;
  // ... etc
}
```

Then, create concrete implementations: `JiraAdapter` and `LinearAdapter`. The core Aigon logic would interact with the `IssueTracker` interface, not the specific implementations.

### Q11: Existing MCP Servers

A quick search for "Jira integration platform as a service" or "unified API for issue trackers" reveals several potential third-party services:
- **Merge.dev:** Provides a unified API for project management tools including Jira and Linear.
- **Workato:** An iPaaS (Integration Platform as a Service) with pre-built connectors for Jira and many other tools.
- **Zapier:** While more for simple "if-this-then-that" workflows, it could be used for basic status updates.

**Tradeoffs:**
- **Pros:** Faster time to market, handles authentication and API differences.
- **Cons:** Adds a third-party dependency and cost. May not support the full depth of integration Aigon needs (e.g., managing sub-tasks in a specific way).

**Recommendation:** For V1, build a direct, minimal integration with the Jira Cloud API to maintain control and understand the problem space. Re-evaluate using a unified API provider for V2 when adding support for multiple issue trackers.

### Q12: Conflict Handling

Conflicts are the hardest part of bidirectional sync.
- **Scenario:** A user moves a Jira ticket from `IN PROGRESS` to `ON HOLD` while an Aigon agent is in the middle of an implementation.
- **Resolution Strategy:**
    1. Aigon's webhook receiver gets the notification.
    2. It checks the feature's state in Aigon. It's `in-progress`.
    3. It runs `aigon feature-pause <id>`. This should gracefully stop the agent's work.
    4. A comment is added to Jira: "Work paused as requested by Jira status change."
- **Optimistic Locking:** When Aigon wants to update a Jira issue, it could first check the `updated` timestamp of the issue. If it has changed since Aigon last saw it, there might be a conflict.

**Recommendation:** For V1 (Aigon-writes-only), this is not an issue. For V2 (bidirectional), Jira should be considered the "master" in case of conflict. If Jira status changes, Aigon should try to gracefully adapt its own state.

### Q13: Minimal Viable Integration (MVP)

1.  **Authentication:** Use a Jira Service Account with an API token stored in Aigon's config.
2.  **Feature Creation:** Implement `aigon feature-import --jira <ID>` to pull an issue from Jira and create a local spec. No Aigon -> Jira creation.
3.  **State Sync (Aigon -> Jira only):**
    - On `feature-start`, transition Jira issue to `IN PROGRESS`.
    - On `feature-close`, transition Jira issue to `DONE`.
4.  **Logging:** On `feature-start`, post a single comment with a link to the Aigon dashboard. On `feature-close`, attach a summary of the work.
5.  **Configuration:** A file in `.aigon/config.json` to store the Jira URL, service account email, API token, and the mapping of Aigon states to Jira status IDs.

This MVP provides significant value by linking Aigon's execution to the enterprise's system of record, without tackling the complexity of full bidirectional sync.

## Recommendation

Based on the findings, the recommended approach is to implement the **Minimal Viable Integration (MVP)** as described above. This provides a solid foundation that delivers immediate value to enterprise teams by respecting Jira as the source of truth for work items. It avoids the significant complexity and risk of a full bidirectional sync for an initial release.

The core of the MVP is the `jira-import-issue` feature, which establishes the link between a Jira issue and an Aigon feature. Subsequent status updates are then pushed from Aigon to Jira, providing visibility to project managers without disrupting the developers' Aigon-based workflow.

Future work can build on this foundation to introduce bidirectional sync (`V2`) and support for other issue trackers like Linear via an adapter pattern.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
| :--- | :--- | :--- | :--- |
| `jira-auth-config` | Configure Jira connection details (URL, user, API token) in a local config file. | high | none |
| `jira-import-issue` | A command to create an Aigon feature spec from an existing Jira issue ID. | high | `jira-auth-config` |
| `jira-push-status` | Automatically update the linked Jira issue's status when the Aigon feature stage changes. | high | `jira-import-issue` |
| `jira-post-summary` | Post a final summary comment and attach artifacts to the Jira issue when an Aigon feature is done. | medium | `jira-push-status` |
| `iss-tracker-adapter`| Refactor the direct Jira integration into a generic adapter pattern to support Linear. | low | `jira-push-status` |

