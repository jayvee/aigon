# Research Findings: Jira Integration

**Agent:** Claude (cc)
**Research ID:** 22
**Date:** 2026-03-28

---

## Key Findings

### 1. Aigon Lifecycle → Issue Tracker Status Mapping

Aigon's state machine (`lib/state-machine.js`) defines six stages for features/research: `inbox`, `backlog`, `in-progress`, `in-evaluation`, `done`, `paused`. These map to issue tracker statuses as follows:

| Aigon Stage | Jira Status Category | Jira Status (typical) | Linear State Type | Notes |
|---|---|---|---|---|
| `inbox` | To Do | Open / New | `backlog` | Jira "To Do" category; Linear uses `backlog` type |
| `backlog` | To Do | To Do / Groomed | `unstarted` | Both trackers support this naturally |
| `in-progress` | In Progress | In Progress / In Development | `started` | Direct mapping on both platforms |
| `in-evaluation` | In Progress | In Review / Code Review | `started` | Requires custom status in Jira; Linear's "In Review" state works |
| `done` | Done | Done / Closed | `completed` | Direct mapping; triggers resolution in both |
| `paused` | To Do | On Hold (custom) | Custom state (`unstarted` type) | Needs custom status on both platforms |

**Key insight**: The `in-evaluation` stage is unique to Aigon (multi-agent competitive evaluation). Most Jira workflows don't have this, so it either maps to "In Review" or requires a custom status. Linear is more flexible — teams can add custom states freely.

**Agent sub-states don't sync**: Aigon's agent statuses (`idle`, `implementing`, `waiting`, `submitted`, `error`) are internal orchestration states within `in-progress`. These should **not** sync to the issue tracker — they're too granular and change too rapidly. Instead, they can be written as issue comments or tracked via custom fields.

### 2. Source of Truth Analysis

Three strategies evaluated:

#### Option A: Jira/Linear as Source of Truth
- **Pros**: Teams already use Jira; no disruption to existing workflows; single source for PMs and managers; issue numbers already used in conversations.
- **Cons**: Aigon's state machine has richer semantics (agent statuses, fleet mode, evaluation); would need to reconstruct Aigon state from Jira transitions; loses the outbox/manifest pattern's crash safety; Jira has no concept of "agents" or "worktrees."
- **Risk**: Jira's workflow constraints may conflict with Aigon's transitions (e.g., can't move from "In Progress" to "In Review" if the Jira workflow doesn't define that transition).

#### Option B: Aigon as Source of Truth
- **Pros**: Aigon's state machine is richer and purpose-built; manifest + outbox pattern provides atomicity; no dependency on external API availability during development.
- **Cons**: Teams can't use their existing Jira workflow for tracking; requires Aigon to push status changes to Jira (one-way sync); PMs lose visibility if Aigon is down.
- **Risk**: Divergence if someone manually moves a Jira issue while Aigon has the feature in a different state.

#### Option C: Bidirectional Sync (Recommended for Full Integration)
- **Pros**: Both systems stay in sync; teams use whichever interface they prefer; PMs track in Jira, developers work in Aigon.
- **Cons**: Most complex to implement; conflict resolution is hard; needs webhook handling or frequent polling; "last write wins" can cause data loss.
- **Risk**: Sync loops (Aigon updates Jira → Jira fires webhook → Aigon tries to update again).

**Recommendation**: Start with **Option B (Aigon as SOT) with one-way push to Jira** for the MVP. This avoids the complexity of bidirectional sync while giving teams visibility in their existing tools. Add pull/webhook support in a later phase.

### 3. Jira Cloud REST API v3

**Endpoints needed for integration:**

| Operation | Endpoint | Auth Required |
|---|---|---|
| Create issue | `POST /rest/api/3/issue` | API token or OAuth |
| Read issue | `GET /rest/api/3/issue/{key}` | API token or OAuth |
| Update issue | `PUT /rest/api/3/issue/{key}` | API token or OAuth |
| List transitions | `GET /rest/api/3/issue/{key}/transitions` | API token or OAuth |
| Execute transition | `POST /rest/api/3/issue/{key}/transitions` | API token or OAuth |
| Add comment | `POST /rest/api/3/issue/{key}/comment` | API token or OAuth |
| Search (JQL) | `POST /rest/api/3/search/jql` | API token or OAuth |
| Register webhook | `POST /rest/api/3/webhook` | OAuth only (not API token) |

**Critical details:**
- **Transitions are constrained**: You must call `GET .../transitions` to discover valid moves from the current status. You cannot jump to an arbitrary status — only to statuses reachable via defined workflow transitions. This is a fundamental difference from Linear.
- **Comments use ADF**: Jira v3 API requires Atlassian Document Format (JSON) for comments, not plain text. Need a helper to wrap markdown in ADF structure.
- **Webhooks require OAuth**: API tokens cannot register webhooks programmatically. For a CLI tool using API tokens, webhooks must be registered manually via Jira admin UI, or the integration must use polling instead.
- **Rate limits**: ~100 requests/minute sustained. Must implement `Retry-After` header handling and exponential backoff on 429 responses.
- **Pagination**: Offset-based (`startAt`/`maxResults`), max 100 per page.

**Authentication recommendation**: API tokens (email + token) for individual developers. Simple, no infrastructure needed. Store in `~/.aigon/config.json` or `$AIGON_JIRA_TOKEN` env var.

Sources:
- https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/
- https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/
- https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/
- https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/
- https://developer.atlassian.com/cloud/jira/platform/rate-limiting/

### 4. Linear API

**Key characteristics:**
- **GraphQL only** — single endpoint at `https://api.linear.app/graphql`
- **No transition constraints** — any issue can be moved to any state via `issueUpdate(stateId: "...")`. No need to discover valid transitions first.
- **States are team-scoped** — each team has its own set of workflow states with types: `backlog`, `unstarted`, `started`, `completed`, `cancelled`.
- **Markdown descriptions** — Linear uses Markdown, not ADF. Much simpler than Jira.
- **Single assignee** — one assignee per issue (no multi-assignee).
- **Official TypeScript SDK** — `@linear/sdk` wraps the GraphQL API with typed methods.

**Authentication**: Personal API keys are ideal for CLI tools. Generated at Settings > API, passed as `Authorization: <api-key>` header. 1,500 requests/hour rate limit.

**Webhooks**: Simple resource-based events (Issue created/updated/removed). Includes `updatedFrom` field showing previous values of changed fields — excellent for detecting state transitions. HMAC-SHA256 signature verification.

Sources:
- https://developers.linear.app/docs/graphql/working-with-the-graphql-api
- https://developers.linear.app/docs/oauth/authentication
- https://developers.linear.app/docs/graphql/webhooks
- https://developers.linear.app/docs/sdk/getting-started

### 5. Adapter Architecture

The fundamental design challenge: Jira and Linear have very different APIs and constraint models.

**Proposed `IssueTrackerAdapter` interface:**

```javascript
// lib/adapters/issue-tracker.js
class IssueTrackerAdapter {
    // Connection
    async connect(config)           // Validate credentials, fetch metadata
    async disconnect()

    // Issue CRUD
    async createIssue(spec)         // From Aigon spec → tracker issue
    async getIssue(externalId)      // Fetch current state from tracker
    async updateIssue(externalId, changes)

    // Status sync
    async getValidTransitions(externalId)  // What moves are possible?
    async transitionTo(externalId, targetStatus)  // Move to a status
    async mapAigonStage(stage)      // Aigon stage → tracker status name

    // Comments / logs
    async addComment(externalId, markdown)  // Implementation log entry
    async getComments(externalId)

    // Discovery
    async searchIssues(query)       // Find issues by project/filter
    async getStatuses()             // All available statuses
    async getProjects()             // Available projects

    // Sync metadata
    async getLastSyncTime(externalId)
}
```

**Key adapter differences:**

| Concern | Jira Adapter | Linear Adapter |
|---|---|---|
| API style | REST with URL building | GraphQL with query construction |
| Status transition | Must discover valid transitions first | Direct `issueUpdate` to any state |
| Comment format | Markdown → ADF conversion | Markdown passthrough |
| Auth | Email + API token (Basic) | API key (Bearer) |
| Rate limiting | ~100 req/min, header-based | 1,500 req/hour, complexity-based |
| SDK | None official (raw HTTP) | `@linear/sdk` (typed GraphQL) |
| Sub-tasks | Native sub-task issue type | `parentId` field (unlimited depth) |

### 6. Fleet Mode → Issue Tracker Mapping

Aigon's Fleet mode (multiple agents competing on the same feature) is unique. Options for mapping to issue trackers:

**Option A: Sub-tasks per agent** (Recommended)
- Parent issue = the feature
- Sub-task per agent = "Implement feature-42 (cc)", "Implement feature-42 (gg)"
- Each sub-task tracks its own status (implementing → submitted)
- Evaluation result updates parent + sub-tasks

**Option B: Labels/tags**
- Single issue with labels like `agent:cc`, `agent:gg`
- Agent status tracked via custom fields or comments
- Simpler but less visible

**Option C: Comments only**
- All agent activity logged as comments on the parent issue
- Lowest effort but hardest to track

**Recommendation**: Option A (sub-tasks) for Fleet mode, with agent activity also logged as comments on the parent issue for narrative visibility.

### 7. Implementation Logs and Artifacts

Where should Aigon's implementation logs go?

| Option | Pros | Cons |
|---|---|---|
| **Jira comments** | Visible in issue, searchable, auto-notifies watchers | Can get noisy; ADF formatting required for Jira |
| **Jira attachments** | Full markdown preserved, no size limit concern | Not inline-readable; requires download |
| **Linked Confluence page** | Rich formatting, collaborative editing | Requires Confluence license; extra API integration |
| **Local with link** | Simplest; no API calls; full markdown | Not accessible to non-developers; lost if repo deleted |

**Recommendation**: **Jira comments for status milestones** (started, submitted, evaluated) + **local logs with a link in the issue description**. This gives PMs visibility for key events without flooding the issue with agent output.

### 8. Conflict Resolution Strategy

When someone moves a Jira issue while Aigon is mid-implementation:

1. **Detection**: Before any Aigon state transition, fetch the current Jira status and compare with expected state.
2. **Soft conflicts**: If Jira moved forward (e.g., someone marked Done while Aigon is still in-progress) → warn the user, don't override.
3. **Hard conflicts**: If Jira moved backward (e.g., someone reopened while Aigon closed) → log the conflict, require manual resolution.
4. **Sync field**: Store `lastSyncedAt` timestamp and `externalStatus` in the manifest to detect drift.

### 9. Existing MCP Servers

The MCP ecosystem for Jira and Linear is surprisingly mature. Both Atlassian and Linear now offer official remote MCP servers, and strong community alternatives exist.

#### Jira MCP Servers

**sooperset/mcp-atlassian** (Community Leader — 4,747 stars, MIT)
- https://github.com/sooperset/mcp-atlassian
- Python-based (`pip install mcp-atlassian`, v0.21.0), runs via `uvx`
- **72 tools** across Jira and Confluence, including:
  - Read: JQL search, get issue, get transitions, boards, sprints, fields, changelogs
  - Write: create/update/delete issues (+ batch), transition issues, add/edit comments, manage sprints, create versions
  - Watchers, Service Desk queues, attachments
- Auth: API tokens (Cloud), PAT (Server/DC), OAuth 2.0
- Supports both Jira Cloud AND Server/Data Center (v8.14+)
- Actively maintained (last push 2026-03-02), 1,038 forks

**atlassian/atlassian-mcp-server** (Official — 503 stars, Apache 2.0)
- https://github.com/atlassian/atlassian-mcp-server
- **Remote/cloud-hosted** at `https://mcp.atlassian.com/v1/mcp` — not a local server
- Auth: OAuth 2.1 (browser flow) or admin-enabled scoped API tokens
- Covers Jira, Confluence, and Compass
- Enterprise-grade: audit logging, Atlassian Cloud permissions
- Cloud-only (no Server/DC). Requires `mcp-remote` proxy for local clients.

**Other notable**: aashari/mcp-server-atlassian-jira (60 stars, TypeScript/npm), nguyenvanduocit/jira-mcp (85 stars, Go, workflow transitions)

#### Linear MCP Servers

**Official Linear Remote MCP** (First-party)
- Hosted at `https://mcp.linear.app/sse`
- Announced: https://linear.app/changelog/2025-05-01-mcp
- Auth: OAuth via Linear's auth flow
- All community servers (jerhadf/linear-mcp-server, 346 stars) have deprecated in favor of this
- The canonical choice for production Linear integration

**tacticlaunch/mcp-linear** (Active Community — 134 stars, MIT)
- https://github.com/tacticlaunch/mcp-linear (`@tacticlaunch/mcp-linear` on npm)
- TypeScript, 35+ tools: issues, comments, projects, cycles, initiatives
- Auth: Linear API token via env var
- Most comprehensive community server still actively maintained

#### MCP vs Direct API: Trade-off Analysis

| Factor | MCP Approach | Direct API |
|---|---|---|
| Development speed | Faster — reuse existing tools | Slower — build from scratch |
| Feature coverage | Good (72 tools for Jira) but not 100% | Full API access |
| Maintenance | Depends on MCP server maintainer | Self-maintained |
| Customization | Low — stuck with tool signatures | High — full control |
| Real-time sync | **No webhook support** — MCP is request/response only | Full webhook/polling support |
| CLI integration | Extra process (stdio/HTTP), serialization overhead | Direct HTTP calls, natural for `lib/adapters/` |
| Auth complexity | Offloaded to MCP server | Must handle yourself |
| Official backing | Both Atlassian and Linear offer first-party remote MCP | N/A |

**Hybrid recommendation**: For the core Aigon CLI integration, **build direct API adapters** (`lib/adapters/jira.js`, `lib/adapters/linear.js`). MCP servers are designed for AI agent interactions, not programmatic CLI-to-API sync. They lack webhook support, add process overhead, and create a dependency on external maintainers.

However, consider a **complementary MCP strategy**:
1. **Consume MCP for AI agent context**: When Aigon agents (Claude Code, Gemini CLI) research or implement features, they could connect to the official Jira/Linear MCP servers to read issue context directly.
2. **Expose Aigon's own MCP server**: Let AI agents interact with Aigon's feature/research board via MCP tools — this is a separate, high-value feature.

### 10. Minimal Viable Integration (MVP)

**Phase 1: Read-only import + status push** (MVP)
- `aigon jira-link <feature-id> <PROJ-123>` — link an Aigon feature to a Jira issue
- On `feature-start`: push status to "In Progress" in Jira
- On `feature-close`: push status to "Done" in Jira
- On `feature-pause`: push status to "On Hold" in Jira
- Store external issue key in manifest: `{ externalIssue: { provider: "jira", key: "PROJ-123", cloudId: "..." } }`
- Config: `aigon config set jira.url https://myteam.atlassian.net` + `aigon config set jira.email user@example.com` + `aigon config set jira.token <api-token>`

**Phase 2: Bidirectional create + comments**
- `aigon jira-import PROJ` — import backlog issues as Aigon features
- `aigon feature-create "name" --jira` — create in both Aigon and Jira
- Push implementation milestones as Jira comments
- Pull Jira description updates into Aigon spec

**Phase 3: Real-time sync + Linear support**
- Webhook receiver (or polling daemon) for Jira status changes
- Linear adapter using `@linear/sdk`
- Generic adapter interface so adding new trackers is straightforward
- Fleet mode sub-task creation

### 11. Configuration Model

```javascript
// .aigon/config.json (project-level)
{
    "issueTracker": {
        "provider": "jira",           // "jira" | "linear" | null
        "jira": {
            "cloudUrl": "https://myteam.atlassian.net",
            "projectKey": "PROJ",
            "statusMapping": {        // Override default mapping
                "in-evaluation": "In Review",
                "paused": "On Hold"
            }
        },
        "linear": {
            "teamId": "TEAM-ID",
            "statusMapping": { ... }
        }
    }
}

// ~/.aigon/config.json (global — credentials)
{
    "jira": {
        "email": "user@example.com",
        "token": "..."               // API token — never in project config
    },
    "linear": {
        "apiKey": "lin_api_..."       // Personal API key
    }
}
```

### 12. Authentication Model

| Provider | Method | Storage | Scopes Needed |
|---|---|---|---|
| Jira Cloud | API token (Basic auth) | `~/.aigon/config.json` or `$AIGON_JIRA_TOKEN` | N/A (full user perms) |
| Linear | Personal API key | `~/.aigon/config.json` or `$AIGON_LINEAR_KEY` | N/A (full user perms) |

For enterprise/team distribution, OAuth 2.0 can be added later. API tokens are sufficient for the developer CLI use case.

## Sources

- Jira Cloud REST API v3: https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/
- Jira Issues API: https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/
- Jira Transitions: https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/#api-rest-api-3-issue-issueidorkey-transitions-get
- Jira Basic Auth: https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/
- Jira OAuth 2.0: https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/
- Jira Webhooks: https://developer.atlassian.com/cloud/jira/platform/webhooks/
- Jira Rate Limiting: https://developer.atlassian.com/cloud/jira/platform/rate-limiting/
- Jira ADF: https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/
- Linear GraphQL API: https://developers.linear.app/docs/graphql/working-with-the-graphql-api
- Linear Authentication: https://developers.linear.app/docs/oauth/authentication
- Linear Webhooks: https://developers.linear.app/docs/graphql/webhooks
- Linear SDK: https://developers.linear.app/docs/sdk/getting-started
- Atlassian MCP Server: https://github.com/atlassian/mcp-atlassian
- Aigon State Machine: `lib/state-machine.js`
- Aigon Manifest System: `lib/manifest.js`
- Aigon Config System: `lib/config.js`

## Recommendation

**Start with a lightweight, Aigon-as-SOT, one-way push integration for Jira Cloud.**

The MVP should be a thin adapter layer (`lib/adapters/jira.js`) that:
1. Links Aigon features to existing Jira issues via `aigon jira-link`
2. Pushes status changes to Jira when Aigon transitions (via `requestTransition` hook or outbox side-effect)
3. Posts milestone comments to Jira (started, submitted, evaluated, closed)
4. Stores the external issue key in the manifest

This gives enterprise teams immediate visibility in Jira without the complexity of bidirectional sync. The adapter interface should be designed from day one to support Linear and future trackers, but only the Jira adapter needs to be built first.

**Do not use MCP servers for the core integration.** They're designed for AI agent interactions, not programmatic sync. Build direct API adapters instead.

**Avoid bidirectional sync in v1.** It introduces conflict resolution complexity, webhook infrastructure requirements (OAuth-only for Jira), and sync loop risks that are not worth the effort for an MVP. One-way push covers 80% of the enterprise need (PM visibility) with 20% of the complexity.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| issue-tracker-adapter-interface | Define the generic IssueTrackerAdapter interface in `lib/adapters/` with connect, CRUD, transition, and comment methods | high | none |
| jira-cloud-adapter | Implement Jira Cloud REST API v3 adapter with API token auth, transition discovery, and ADF comment formatting | high | issue-tracker-adapter-interface |
| jira-link-command | `aigon jira-link <feature-id> <JIRA-KEY>` — link an Aigon feature to an existing Jira issue, store in manifest | high | jira-cloud-adapter |
| jira-status-push | Automatically push Aigon state transitions to linked Jira issues via `requestTransition` side-effects | high | jira-link-command |
| jira-comment-milestones | Post implementation milestone comments (started, submitted, evaluated, closed) to linked Jira issues | medium | jira-link-command |
| jira-config-commands | `aigon config set jira.*` commands for URL, email, token, project key, and status mapping overrides | high | none |
| jira-import-backlog | `aigon jira-import <project-key>` — import Jira backlog issues as Aigon feature specs | medium | jira-cloud-adapter |
| jira-create-push | `aigon feature-create "name" --jira` — create feature in both Aigon and Jira simultaneously | medium | jira-cloud-adapter |
| linear-adapter | Implement Linear GraphQL adapter using `@linear/sdk` with personal API key auth | medium | issue-tracker-adapter-interface |
| jira-fleet-subtasks | Create Jira sub-tasks per agent in Fleet mode, track agent status on sub-tasks | low | jira-status-push |
| jira-bidirectional-sync | Webhook/polling receiver for Jira→Aigon status changes with conflict detection | low | jira-status-push |
| aigon-mcp-server | Expose Aigon features/research as MCP tools for AI agents (separate from issue tracker integration) | low | none |
