# Research: jira-integration

## Context

Enterprise teams typically use project management tools like Jira or Linear as their source of truth for work items. Currently Aigon manages features and research entirely through local markdown specs and folder-based state (`docs/specs/features/`). For enterprise adoption, Aigon needs to integrate with these tools — syncing features bidirectionally so teams can continue using their existing workflows while leveraging Aigon's multi-agent development capabilities. This research should explore how Aigon could sync with Jira (primary) and Linear (secondary), covering the full lifecycle from issue creation through implementation and completion.

## Questions to Answer

- [ ] What are the natural sync points between Aigon's feature lifecycle and Jira issue statuses? (e.g., inbox→backlog→in-progress→done maps to which Jira statuses?)
- [ ] Should Jira be the source of truth, Aigon be the source of truth, or bidirectional sync? What are the tradeoffs of each?
- [ ] How would feature creation work? Pull from Jira → create local spec, or create in Aigon → push to Jira?
- [ ] Where should implementation logs be written? Jira comments, attachments, linked Confluence pages, or kept local with a link?
- [ ] How would Aigon's state machine transitions (`requestTransition`) sync with Jira status changes?
- [ ] How should agent assignments and Fleet mode map to Jira? (assignees, labels, sub-tasks?)
- [ ] What Jira APIs are needed? (REST v3, webhooks for real-time sync, JQL for queries)
- [ ] How would evaluation results and winner selection be reflected in Jira?
- [ ] What is the authentication model? (OAuth, API tokens, per-user vs service account)
- [ ] How would this work with Linear? Is there enough commonality to build a generic "issue tracker adapter" pattern?
- [ ] What MCP servers exist for Jira/Linear that Aigon could leverage instead of building direct integrations?
- [ ] How should conflicts be handled? (e.g., someone moves a Jira issue while Aigon is mid-implementation)
- [ ] What is the minimal viable integration? (read-only import vs full bidirectional sync)

## Scope

### In Scope
- Jira Cloud REST API capabilities and sync patterns
- Linear API as a secondary integration target
- Mapping Aigon's state machine to issue tracker statuses
- Implementation log and artifact sync strategies
- Authentication and configuration models
- Adapter/plugin architecture for multiple issue trackers

### Out of Scope
- Jira Server/Data Center (on-prem) — focus on Cloud first
- Other tools beyond Jira and Linear (GitHub Issues, Asana, etc.) — mention only if the adapter pattern naturally supports them
- Building the integration — this is research only
- Jira project/board configuration or admin workflows

## Inspiration
- Aigon state machine: `lib/state-machine.js` — defines feature lifecycle stages
- Aigon manifest system: `lib/manifest.js` — per-feature state tracking
- Jira REST API v3: https://developer.atlassian.com/cloud/jira/platform/rest/v3/
- Linear API: https://developers.linear.app/docs

## Findings

See agent findings in `docs/specs/research-topics/logs/`:
- `research-22-cc-findings.md` — Claude: deepest API reference, MCP ecosystem survey, phased MVP proposal
- `research-22-gg-findings.md` — Gemini: Jira-as-SOT framing, enterprise-first import workflow, service account auth
- `research-22-cx-findings.md` — Codex: field-ownership bidirectional model, category-based status mapping, webhook-first conflict handling

**Consensus across all agents:**
1. Status mapping should be category-based (Jira status categories), not hardcoded status names
2. MVP should be import-first + one-way outbound sync (no bidirectional in v1)
3. Generic adapter interface with Jira first, Linear second
4. Logs stay local; trackers get compact milestone comments with links
5. API token auth for MVP; OAuth later
6. Hook into `requestTransition` for outbound sync
7. MCP servers exist but aren't suitable as the sync backbone — use direct API adapters
8. Linear is simpler (GraphQL, no transition constraints, markdown-native) and should come second

**Key divergence:** Source of truth strategy — CC recommends Aigon-as-SOT, GG recommends Jira-as-SOT, CX proposes field-ownership split (tracker owns planning fields, Aigon owns execution artifacts). The field-ownership model is the most nuanced and was adopted for the conflict handling feature.

## Recommendation

**Build in four layers, starting with Aigon-as-SOT one-way push:**

1. **Foundation** — Generic adapter interface, Jira Cloud adapter, config commands, import/link commands
2. **Lifecycle sync** — Outbound status push via `requestTransition`, milestone comments, `--jira` create flag
3. **Linear adapter** — Same interface, simpler implementation (GraphQL, no transition discovery, markdown comments)
4. **Webhook + conflict handling** — Inbound sync with field-ownership model, conflict detection and dashboard resolution UI

Start with API tokens for auth. Avoid bidirectional content sync. Use MCP servers only as optional agent convenience, not as the integration backbone.

## Output

### Selected Features

| Feature Name | Description | Priority | Spec |
|--------------|-------------|----------|------|
| jira-integration-foundation | Adapter interface + Jira Cloud adapter + config + import/link | high | `docs/specs/features/01-inbox/feature-jira-integration-foundation.md` |
| jira-lifecycle-sync | Outbound status push + milestone comments + `--jira` create | high | `docs/specs/features/01-inbox/feature-jira-lifecycle-sync.md` |
| linear-adapter | Linear GraphQL adapter using `@linear/sdk` | medium | `docs/specs/features/01-inbox/feature-linear-adapter.md` |
| tracker-webhook-conflict | Webhook ingestion + field-ownership conflict resolution | medium | `docs/specs/features/01-inbox/feature-tracker-webhook-conflict.md` |

### Feature Dependencies
- jira-lifecycle-sync depends on jira-integration-foundation
- linear-adapter depends on jira-integration-foundation (for the adapter interface)
- tracker-webhook-conflict depends on jira-lifecycle-sync

### Not Selected
- `jira-fleet-subtasks` (low priority — labels/comments sufficient for Fleet mode per CX's recommendation)
- `aigon-mcp-server` (low priority — separate concern, not part of issue tracker integration)
- `mcp-tracker-operations` (low priority — MCP as optional convenience, not sync backbone)
- `jira-bidirectional-sync` (subsumed by tracker-webhook-conflict with field-ownership model)
