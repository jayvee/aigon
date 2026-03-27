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
<!-- Document discoveries, options evaluated, pros/cons -->

## Recommendation
<!-- Summary of recommended approach based on findings -->

## Output
<!-- Based on your recommendation, create the necessary feature specs by running the `aigon feature-create "<name>"` command. Link the newly created files below. -->
- [ ] Feature:
