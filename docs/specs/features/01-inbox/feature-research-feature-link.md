---
complexity: medium
---

# Feature: research-feature-link

## Summary
Add a structured `research:` frontmatter field to feature specs that records which research topic created the feature. This gives features an explicit, queryable link to their parent research — the same pattern as `set:` and `depends_on:`. The dashboard uses it to surface related features inside the research detail panel (Agent Log → FEATURES sub-tab), so done research has a complete "what we found → what we decided to build" view in one place. The `research-eval` command template is updated so eval agents always stamp new features with the research ID automatically.

## User Stories
- [ ] As a maintainer reviewing a done research topic, I open the Agent Log tab and see a FEATURES sub-tab listing every feature created from this research — ID, name, stage, and set — without leaving the research detail panel.
- [ ] As a developer reading a feature spec, I see `research: 44` in the frontmatter and immediately know which research topic produced this work item.
- [ ] As an eval agent running `research-eval`, I create feature specs that already carry `research: {id}` in frontmatter — no manual backfill needed for future research.

## Acceptance Criteria
- [ ] `templates/specs/feature-template.md` frontmatter includes `research:` as a commented-out optional field, documented the same way `agent:` is.
- [ ] `lib/cli-parse.js parseFrontMatter` normalises `research:` as a scalar integer or array of integers (same normalization pattern as `depends_on`).
- [ ] `lib/feature-sets.js` exports `readResearchTag(content)` — parses the `research:` field from a feature spec, returns a single ID (number) or array of IDs, or `null`.
- [ ] `lib/dashboard-status-collector.js` exports `collectFeaturesForResearch(repoPath, researchId)` — scans all feature stage folders, parses frontmatter, and returns an array of `{ id, name, stage, set, complexity, specPath }` for features whose `research:` field matches `researchId`. Reuses the existing spec-scan infrastructure; does not add a new full-filesystem walk.
- [ ] `lib/dashboard-server.js` includes `relatedFeatures` in the research detail payload (from `collectFeaturesForResearch`). Empty array when none found.
- [ ] `templates/dashboard/js/detail-tabs.js` `renderLog` adds a **FEATURES** sub-tab when `payload.relatedFeatures` is non-empty and the entity type is research. The tab renders a simple HTML list: `#ID name — stage badge — set (if any)`. Each row is not a link (drawer navigation is out of scope), just a readable summary.
- [ ] `templates/generic/commands/research-eval.md` instructs the eval agent to include `research: {id}` in the frontmatter of every feature spec it creates (alongside `set:` and `complexity:`). The research ID is available to the agent as the research ID from the command context.
- [ ] F399, F400, F401, F402 are backfilled with `research: 44` in their frontmatter.
- [ ] A unit test in `test/` pins that `parseFrontMatter` handles `research: 44` (scalar) and `research: [44, 21]` (list) correctly.
- [ ] A unit test pins that `collectFeaturesForResearch` returns the correct features for a fixture set of specs.

## Pre-authorised
- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Technical Approach
- `parseFrontMatter` already handles arbitrary YAML keys. Add a normalization block after the existing `depends_on` normalization: if `research:` is a scalar, wrap in array and cast to integers; if already an array, cast elements to integers. Expose as `data.research: number[]`.
- `readResearchTag` in `feature-sets.js` follows the same shape as `readSetTag`: call `parseFrontMatter`, extract `data.research`, return normalized value or `null`.
- `collectFeaturesForResearch` scans the six stage folders under `docs/specs/features/` (inbox, backlog, in-progress, in-evaluation, done, paused). For each `.md` file, call `parseFrontMatter`, check `data.research` includes `researchId`, and build the result row from the filename (for id/name/stage) and frontmatter (for set/complexity). Same file-scan pattern as `scanFeatureSets` — synchronous, cheap.
- Dashboard server: call `collectFeaturesForResearch(absRepo, id)` in the research branch of `buildDetailPayload`, include as `relatedFeatures`.
- Frontend `renderLog`: inject a synthetic `_features` entry into the `logs` object whose `content` is a markdown table of related features. Leading underscore ensures it sorts after CC/GG/OP alphabetically. The existing picker renders the FEATURES sub-tab with no other changes needed.
- Backfill: edit F399–F402 spec files directly — this is metadata, not a state transition, so no CLI command is needed.

## Dependencies
- depends_on: none

## Out of Scope
- Making FEATURES sub-tab rows clickable/navigable to the feature drawer (separate task).
- Showing the research link on the kanban board card itself.
- Retroactively backfilling research older than R44.
- Referential integrity validation (no check that the referenced research ID exists).

## Related
- Research: R44 — competitive positioning and landscape
- Set: competitive-positioning
