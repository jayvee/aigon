# Feature: feature-dependency-enforcement

## Summary
Block `feature-start` when declared dependencies are not in `05-done`, with a `--force` override for intentional bypass. Show "Blocked by #ID" labels on dashboard/board cards and disable the start action for blocked features.

## User Stories
- [ ] As a developer, I want `feature-start` to block when my feature's dependencies aren't complete, so I don't build on unstable foundations
- [ ] As a developer, I want a `--force` flag to bypass the block when I intentionally need to scaffold ahead
- [ ] As a developer, I want to see which backlog features are blocked on the dashboard so I know what's ready to start

## Acceptance Criteria
- [ ] `feature-start` reads `depends_on` from spec frontmatter and checks each dependency's stage
- [ ] If any dependency is not in `05-done/`, `feature-start` exits with clear error listing unmet deps (e.g., `Feature 132 is blocked by: #121 (docs-merge-repos) [in-progress], #126 (aade-extract) [backlog]`)
- [ ] `feature-start --force` bypasses the dependency check with a warning
- [ ] Dashboard pipeline view shows "Blocked by #121" label on blocked backlog cards
- [ ] Board/list view shows blocked indicator on features with unmet dependencies
- [ ] Start action is disabled/greyed for blocked features in dashboard
- [ ] Board summary shows blocked count: `Backlog: 5 (2 blocked)`
- [ ] `node -c aigon-cli.js` passes

## Validation
```bash
node -c aigon-cli.js
```

## Technical Approach
- Enforcement in `feature-start` (`lib/commands/feature.js`): before `requestTransition()`, resolve each dependency's current stage by scanning `05-done/` for matching spec files
- `--force` flag added to feature-start argument parsing, logs warning when used
- Dashboard reads `dependsOn` from coordinator manifests (mirrored by feature-dependency-system), cross-references with feature stages to compute blocked state
- `lib/dashboard-server.js` `collectDashboardStatusData()` adds `blockedBy` array to feature objects
- Board rendering in `lib/board.js` shows blocked label and count

## Dependencies
- feature-dependency-system (provides `depends_on` frontmatter parsing and manifest mirroring)

## Out of Scope
- Visual dependency graph/arrows (see feature-dependency-graph-viz)
- Enforcement at other lifecycle points (e.g., feature-close)
- Soft-warn mode (hard block + --force is the chosen approach)

## Open Questions
- None (resolved by research-20)

## Related
- Research: research-20-feature-dependencies
- Upstream: feature-dependency-system
- Downstream: feature-dependency-graph-viz
