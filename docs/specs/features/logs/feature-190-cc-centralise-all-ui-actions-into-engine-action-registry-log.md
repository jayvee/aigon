---
commit_count: 3
lines_added: 370
lines_removed: 48
lines_changed: 418
files_touched: 12
fix_commit_count: 0
fix_commit_ratio: 0
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 5144
output_tokens: 32145
cache_creation_input_tokens: 424215
cache_read_input_tokens: 10239588
thinking_tokens: 0
total_tokens: 10701092
billable_tokens: 37289
cost_usd: 25.8014
sessions: 1
model: "claude-opus-4-6"
tokens_per_line_changed: 89.21
---
# Implementation Log: Feature 190 - centralise-all-ui-actions-into-engine-action-registry
Agent: cc

## Plan

Extend the existing action derivation pipeline to include infra/view actions alongside workflow actions. Rather than building a separate system, infra candidates use the same `bypassMachine: true` pattern as existing bypass actions (like `open-session`), evaluated against an enriched snapshot context that includes dashboard agent data.

## Progress

- Added 7 new ManualActionKind values and ActionCategory enum to types.js
- Added FEATURE_INFRA_CANDIDATES (6 actions) and RESEARCH_INFRA_CANDIDATES (4 actions) to rules files
- Updated workflow-rules.js to merge infra candidates into getActionCandidates()
- Updated actions.js to pass through scope, metadata, clientOnly fields
- Added SNAPSHOT_ACTION_DESCRIPTORS for all new infra action kinds
- Key wiring: workflow-read-model.js enriches snapshot context with infra data (devServerPokeEligible, flags, findingsPath, evalPath, evalSession) before action derivation
- Updated pipeline.js to render per-agent infra actions from validActions instead of hardcoded eligibility checks
- Updated actions.js to filter infra/view actions from card-level renderActionButtons (they render inline in agent sections)
- Added rule 8 to CLAUDE.md: never add eligibility logic in frontend files
- Documented unified action registry in docs/architecture.md

## Decisions

1. **Single derivation pipeline** — Infra actions use the same `deriveAvailableActions()` as workflow actions, rather than a separate system. This keeps the architecture simple and means any UI consumer gets all actions from one API call.

2. **Context enrichment in workflow-read-model** — Rather than threading infra data through many layers, `enrichSnapshotWithInfraData()` merges dashboard agent infra fields into the snapshot context right before action derivation. This keeps the engine clean while giving guards access to infra data.

3. **Infra actions have null commands** — Infra/view actions don't need CLI command strings (they use API endpoints or client-side handlers), so `mapSnapshotActionToDashboard` returns `null` for their command field.

4. **Frontend rendering by category** — In `buildAgentSectionHtml()`, actions are partitioned by category: infra/view actions render first (dev-poke, flags, findings), then workflow actions. The card-level `renderActionButtons()` filters out infra/view actions since they're handled inline in agent sections.

5. **Repo-level actions left as global UI affordances** — Per the spec's out-of-scope section, repo-level actions (Ask agent, Create feature, Main dev server start) remain in sidebar.js as global UI affordances since they don't have per-entity context.

## Issues

None — all 13 existing tests pass with the changes.
