---
set: feature-set
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-23T00:40:18.596Z", actor: "cli/feature-prioritise" }
---

# Feature: feature-set-5-dashboard-card

## Summary
Add a dedicated set-level card to the dashboard that shows aggregate progress for a feature set: progress bar (N of M merged), dependency graph visualization, currently-active feature, and action buttons (`start`, `stop`, `resume`, `reset`). This turns feature-set-1's collapsible grouping + feature-set-3's SetConductor into a cohesive "command center" view so the user can drive a running set without typing CLI commands. Extends the existing dashboard action-registry pattern with a `set-*` action family — no ad-hoc action logic in the frontend (per CLAUDE.md Rule 8).

## User Stories
- [ ] As a user watching a running set, I can see a dedicated card with progress, the current feature, and the last event without clicking into any individual feature.
- [ ] As a user, I can click `Start` on an idle set card to launch the SetConductor directly from the dashboard.
- [ ] As a user of a paused set, I can click `Resume` on the card once I've fixed the failing member.
- [ ] As a user wanting the topology, the card includes a dep-graph mini-view showing member order and which nodes are done / in-progress / blocked.

## Acceptance Criteria
- [ ] New dashboard card component rendered per active set in a dedicated "Sets" section of the dashboard UI.
- [ ] Card displays: set slug, goal (if present), progress bar (merged / total), status label (`idle` / `running` / `paused-on-failure` / `done`), current feature id + label (when running), last event / timestamp from set-auto state.
- [ ] Dep-graph mini-view inside the card (SVG or simple grid), members colored by workflow state (backlog / in-progress / in-review / done / failed).
- [ ] Action buttons rendered from the central action registry: `set-autonomous-start`, `set-autonomous-stop`, `set-autonomous-resume`, `set-autonomous-reset`. Eligibility logic lives in the registry (new `lib/feature-set-workflow-rules.js` or similar) — **not** in the frontend. Frontend renders from the `validActions` API response only.
- [ ] Card is read-only with respect to engine state (CLAUDE.md memory: dashboard must be read-only; actions go through the existing HTTP action-dispatch path that invokes the CLI).
- [ ] Playwright screenshot captured after the visual change (CLAUDE.md Rule 3).
- [ ] `Skill(frontend-design)` invoked before any CSS/component work begins (CLAUDE.md mandatory rule).
- [ ] Tests cover: action eligibility derivation (e.g. `resume` only when `status === 'paused-on-failure'`), dep-graph rendering correctness, and the action-registry wiring.

## Validation
```bash
node -c aigon-cli.js
npm test
MOCK_DELAY=fast npm run test:ui
```

## Technical Approach
- **Action registry**: new module following the shape of `lib/feature-workflow-rules.js` — define the `set-*` actions, their eligibility predicates against set-auto state, and their CLI command strings. Exposed via `validActions` in the API payload, consumed by the frontend.
- **Collector**: `lib/dashboard-status-collector.js` gets a `sets` section that reads the set-auto state files, joins with per-feature workflow snapshots (via `lib/workflow-snapshot-adapter.js`), and derives the card payload shape. Pure read path — no engine mutation.
- **Frontend**: edits in `templates/dashboard/index.html`. Uses shadcn/ui components where applicable per CLAUDE.md frontend rules. Dep-graph rendered from the `depends_on` edges of member specs (already available from feature-set-1's scanner).
- **HTTP action dispatch**: action buttons POST to the existing server action endpoint, which invokes the matching `aigon set-autonomous-*` CLI command. No new WebSocket events, no new state mutations from the frontend.
- **Pro awareness**: if the SetConductor actions are gated behind `@aigon/pro`, the card still renders for OSS users (read-only progress view) with the action buttons disabled and a pointer tooltip. This matches the OSS-visibility / Pro-action split already used by AutoConductor.

## Dependencies
- depends_on: feature-set-3-autonomous-conductor

## Out of Scope
- Inline editing of set metadata (membership, goal) from the card — edit the spec frontmatter or use CLI
- Cross-set overview / swimlanes (the board-grouping UX is covered in feature-set-1)
- Per-feature action buttons inside the set card (use the existing feature cards)
- Set-level telemetry widget / cost rollups (deferred to `feature-set-telemetry-rollup`)

## Open Questions
- Should the dep-graph mini-view be a static SVG rendered server-side or a small client-side layout? Leaning client-side for responsiveness, but either is fine.
- Where does the set card sit in the dashboard layout — above the feature cards, in a sidebar, or as an opt-in "Sets" tab? Defer to the `frontend-design` skill during implementation.

## Related
- Research: #34 feature-set
