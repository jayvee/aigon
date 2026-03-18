# Feature: dashboard-manifest-reader

## Summary
Refactor the dashboard's `collectDashboardStatusData()` (400+ lines assembling state from 5 independent signals) to read from manifest files in `.aigon/state/`. The dashboard becomes a simple consumer of the manifest API instead of an independent state assembler.

## User Stories
- [ ] As a dashboard user, I see consistent state because the dashboard reads the same source of truth as CLI commands
- [ ] As a developer maintaining the dashboard, I read manifests instead of scanning 5 different signal sources

## Acceptance Criteria
- [ ] `collectDashboardStatusData()` replaced with manifest-based reading
- [ ] Dashboard reads coordinator manifests for stage, agents, pending ops
- [ ] Dashboard reads per-agent status files for agent-level status
- [ ] Folder scanning retained only for features without manifests (backward compat via lazy bootstrap)
- [ ] `knownAgentsByFeature` assembly logic simplified — agents listed in manifest, not inferred from worktree names + log filenames
- [ ] Phantom agent problem eliminated (no more mismatches between worktree names and log names)
- [ ] Dashboard API responses include pending operations for features mid-transition
- [ ] Visual behavior unchanged — same cards, same statuses, same layout
- [ ] `node -c lib/dashboard-server.js` passes

## Validation
```bash
node -c lib/dashboard-server.js
npm test
```

## Technical Approach
- Replace the body of `collectDashboardStatusData()` with: list `.aigon/state/feature-*.json` files, for each read manifest + agent status files
- Fall back to current logic for features without manifests (lazy bootstrap creates them)
- Remove worktree directory scanning for agent discovery — manifest `agents` array is authoritative
- Remove `normalizeDashboardStatus()` fallback logic — status comes from manifest or is genuinely unknown

## Dependencies
- state-manifest-core (needs manifest read API)

## Out of Scope
- Dashboard UI redesign
- New dashboard features (pending ops display could be a follow-up)

## Open Questions
- Should pending operations be surfaced in the dashboard UI? (Nice-to-have, not required)

## Related
- Research: `docs/specs/research-topics/04-done/research-14-unified-feature-state.md`
- Findings: `docs/specs/research-topics/logs/research-14-cc-findings.md` (Part 5: Unified Consumer API)
- Depends on: state-manifest-core
