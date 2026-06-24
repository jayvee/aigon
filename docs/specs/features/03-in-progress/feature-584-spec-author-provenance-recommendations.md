---
complexity: high
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-24T12:33:01.439Z", actor: "cli/feature-prioritise" }
---

# Feature: spec-author-provenance-recommendations

## Summary

Track original spec author provenance for feature and research specs, including the authoring agent and selected launch triplet when available. Use that provenance to guide spec-review and spec-revise agent selection without implying that an agent "owns" a spec or that revision changes original authorship.

## User Stories

- [ ] As a user choosing a spec-review agent, I can see which agent/model originally created the spec so I can intentionally pick a different reviewer when that makes sense.
- [ ] As a user launching spec-revise, the picker defaults to the original spec author agent/model when that provenance is available, because that is usually the best continuation context for applying review feedback.
- [ ] As a user scanning feature and research cards, I can see the spec author agent/model at a glance.
- [ ] As a user reviewing history, I can distinguish "original spec author" from "last revised by" so provenance is not overwritten by later review-revision work.

## Acceptance Criteria

- [ ] Feature and research workflow snapshots expose a stable `specAuthor` object containing `agentId`, `model`, `effort`, and `authoredAt`; unknown sub-fields are explicit `null` (never omitted, never inferred from defaults).
- [ ] `authorAgentId` remains available as a compatibility alias or fallback for existing callers until all consumers have migrated. Its current fallback chain (`snapshot.authorAgentId || Object.keys(agents)[0]` in `dashboard-status-collector.js`, plus `set-conductor`, `machine.js`, `projector.js`) continues to resolve identically for legacy snapshots.
- [ ] `aigon feature-create --agent <id> ...` and `aigon research-create --agent <id> ...` stamp the selected agent as the original spec author even when `AIGON_AGENT_ID` is not set in the parent process. Note the two current producer gaps both paths must close: `entity.js` bootstrap (`afterWrite`) reads only `process.env.AIGON_AGENT_ID` and ignores `options.agent`; `research-create` (`lib/commands/research.js`) validates `--agent` but then calls `entityCreate(def, name, ctx, { description })` without forwarding it.
- [ ] Dashboard-launched create/spec-authoring paths record the selected model and effort when the user picked them; if no model/effort was selected, the fields are null rather than inferred from mutable defaults.
- [ ] Spec-revise completion records separate revision provenance such as `lastSpecRevision`, but does not replace the original `specAuthor`. The projector must project `specAuthor` immutably from the bootstrap/start event and must NOT re-derive it from later events — today `projector.js` recomputes `authorAgentId` as `event.authorAgentId ?? context.authorAgentId` on every projection (lines ~138/166), so a `feature.spec_revision.completed` event that carries an agent must not be allowed to overwrite the original author.
- [ ] The spec-review agent picker annotates or highlights the row that matches the original spec author, including the model/effort label when known.
- [ ] The spec-revise agent picker preselects the original author agent and model/effort when known, with a label that explains the recommendation is based on original spec authorship.
- [ ] Feature and research cards show concise spec author metadata, for example `Spec by Codex` or `Spec by Codex - gpt-...` when a model is known.
- [ ] Legacy specs with only frontmatter `agent:` or snapshot `authorAgentId` still get useful behavior: agent annotation/defaulting works, model/effort are null, and no migration is required for normal dashboard use.
- [ ] Tests cover feature and research create, dashboard payload shape, picker preselection/annotation behavior, and the "revision does not replace original author" invariant.

## Validation

```bash
npm test
node -c aigon-cli.js
```

## Technical Approach

Treat this as spec author provenance, not ownership. The original author should be immutable for normal flows; later revisions should append or update separate revision metadata.

Likely implementation path:

1. Add a small provenance helper that normalizes the existing sources into one read shape:
   - new snapshot/event fields when present
   - legacy `snapshot.authorAgentId`
   - optional spec frontmatter `agent:`
   - null model/effort for legacy-only sources
2. Extend workflow bootstrap/start events for feature and research specs to carry `specAuthor` metadata. Keep this additive so existing snapshots and event logs continue to project. Capture `specAuthor` once at the bootstrap/start event and have the projector copy it forward verbatim; do not re-derive it per event the way `authorAgentId` is currently recomputed (see acceptance criterion on the immutability invariant).
3. Update `entityCreate` and the feature/research `--agent` create handlers so the explicitly selected draft agent is passed into workflow bootstrap. Do not rely only on `process.env.AIGON_AGENT_ID`.
4. Thread dashboard picker launch triplets into spec-authoring metadata only when they are explicit user selections. Do not infer model IDs from current defaults after the fact, because defaults drift over time.
5. Extend spec-revise record events with revision provenance (`agentId`, `model`, `effort`, `revisedAt`, commit SHA where available). Project this separately from original authorship.
6. Add author provenance to the canonical read model in `lib/read-model/entity-view.js`, then have dashboard collector/detail payloads project from it instead of ad hoc `authorAgentId` fallbacks.
7. Update `templates/dashboard/js/actions/spec-review.js` and the shared agent picker rendering so:
   - spec-review highlights the original author row
   - spec-revise preselects the original author triplet
   - labels use "original spec author" or "created this spec", never "owner"
8. Update feature/research cards in the dashboard pipeline rendering to display concise author provenance.

Important constraints:

- Do not put model IDs or effort levels in spec frontmatter. Specs remain product/process documents; runtime provenance belongs in workflow events/snapshots.
- Do not change lifecycle states for this feature.
- Do not make spec revision mutate the original author.
- Keep feature and research behavior parallel by using shared entity helpers where possible.

## Dependencies

- None

## Out of Scope

- Rewriting historic event logs to backfill exact model/effort for old specs.
- Adding model IDs to spec frontmatter.
- Changing code-review author attribution or implementation commit attribution.
- Inferring author model/effort from current config defaults when the original explicit selection is unknown.
- Introducing an "owner" concept for specs.

## Open Questions

- Should spec author provenance be shown on inbox and backlog cards only, or also in active/done cards?
- For manually created specs with no agent provenance, should the UI show nothing or a neutral `Human/manual` label?
- If a user explicitly chooses a different agent/model for spec-revise, should that become the default for future revise cycles, or should the original author remain the recommendation? (The body's immutability constraint and User Story 2 currently lean toward "original author stays the recommendation"; confirm before implementing the preselect logic.)

## Related

- Existing fields: `snapshot.authorAgentId`, spec frontmatter `agent:`
- Existing UI: dashboard spec-review/spec-revise picker preselection
