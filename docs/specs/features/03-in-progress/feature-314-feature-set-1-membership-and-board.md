# Feature: feature-set-1-membership-and-board

## Summary
Introduce a lightweight "feature set" abstraction: an optional `set: <slug>` field in feature spec frontmatter that groups related features together, a scanner that surfaces members, read-only CLI commands (`aigon set list`, `aigon set show <slug>`), and a collapsible-group view on the board/dashboard. No new lifecycle entity — set state is derived entirely from the workflow state of its members (mirrors the Linear Projects / GitHub Milestones pattern). This is the OSS foundation that later features layer autonomy and visualization on top of.

## User Stories
- [ ] As a user who just finished a research evaluation that produced 3–5 related features, I can tag them all with the same `set:` value and see them grouped on the board instead of scattered across the backlog.
- [ ] As a user running `aigon set list`, I can see every active set with a `N/M complete` summary derived from member feature status.
- [ ] As a user running `aigon set show <slug>`, I can see the member features, their current workflow state, and their `depends_on` graph.
- [ ] As a user on the dashboard, I can toggle a "group by set" view so grouped features render under a set header with a shared progress bar.

## Acceptance Criteria
- [ ] Feature spec frontmatter accepts an optional `set: <slug>` field; parser preserves it through all lifecycle transitions.
- [ ] New read-side helper (likely in `lib/entity.js` or a new `lib/feature-sets.js`) scans all feature specs and returns `{ setSlug → [featureIds] }`.
- [ ] `aigon set list` prints a table of active sets: slug, member count, status counts (backlog / in-progress / done), last-updated.
- [ ] `aigon set show <slug>` prints members in topological order using the existing `depends_on` graph (reuses `lib/entity.js` DFS), with per-feature workflow state.
- [ ] Dashboard board renders a collapsible group header per set when "group by set" is enabled; ungrouped features still render as today.
- [ ] No changes to the workflow-core engine, no new event types, no new folders under `.aigon/`. Set state is purely derived.
- [ ] Tests cover: frontmatter round-trip, scanner correctness on a fixture with mixed tagged/untagged specs, `set list` / `set show` output, and the board grouping read path.

## Validation
```bash
node -c aigon-cli.js
npm test
```

## Technical Approach
- **Frontmatter key**: `set:` (short, consistent with `depends_on`). Reject slugs that contain slashes or whitespace.
- **Scanner**: a pure read helper; does not mutate engine state. Called by CLI + dashboard collector.
- **CLI**: new domain section `aigon set ...` dispatched from `aigon-cli.js`; commands implemented in a new `lib/commands/set.js` factory following the existing `ctx` pattern.
- **Dashboard**: extend `lib/dashboard-status-collector.js` to attach a `set` key to feature status payloads and expose a `sets` roll-up section in the summary payload. `templates/dashboard/index.html` gets the group-by-set toggle (screenshot required per Rule 3).
- **Board**: `lib/board.js` gets a group-by-set rendering mode behind a flag.
- **Topological ordering**: reuse `lib/entity.js` dep-graph + cycle detection as-is; do not fork.

## Dependencies
- none

## Out of Scope
- SetConductor / autonomous execution (feature-set-3)
- Failure-pause / resume semantics (feature-set-4)
- Set-level dashboard card with action buttons (feature-set-5)
- Automatic set-emission from `research-eval` (feature-set-2)
- Manifest file under `.aigon/feature-sets/<slug>.json` (deferred — all three agents agree tag-only is enough for MVP)
- Telemetry rollup by set (`feature-set-telemetry-rollup`, deferred)
- Parallel execution / ready-queue (`feature-set-parallel-execution`, deferred)

## Open Questions
- Should `aigon set list` filter out sets whose members are all in `done`, or show them with a "complete" badge for historical review?
- Is the board "group by set" toggle a user preference (persisted in config) or a per-session query param?

## Related
- Research: #34 feature-set
