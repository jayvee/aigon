# Feature: agent-status-out-of-worktree

## Summary
Move agent status reporting from log file YAML frontmatter (inside worktrees) to per-agent JSON files in `.aigon/state/` (in the main repo). Log files become pure human-readable narrative markdown with no machine state. Absorbs log-narrative-only.

## User Stories
- [ ] As the dashboard, I can read agent status from `.aigon/state/feature-{id}-{agent}.json` without scanning worktree directories
- [ ] As an agent, I write my status to a file in the main repo that survives worktree deletion
- [ ] As a user reading a log file, I see a clean implementation narrative without YAML frontmatter noise

## Acceptance Criteria
- [ ] `feature-setup` writes `AIGON_MAIN_REPO=/path/to/repo` into worktree's `.aigon/worktree.json`
- [ ] `agent-status` command resolves `AIGON_MAIN_REPO` and writes to `.aigon/state/feature-{id}-{agent}.json`
- [ ] Per-agent status file schema: `{ agent, status, updatedAt, worktreePath }`
- [ ] Agent status values: `implementing`, `waiting`, `submitted`, `error`
- [ ] Log files no longer have YAML frontmatter (`---` blocks removed)
- [ ] `updateLogFrontmatterInPlace()` replaced with `writeAgentStatus()` from manifest module
- [ ] Dashboard reads agent status from manifest files, not log frontmatter
- [ ] Worktree deletion no longer loses agent status information
- [ ] `npm test` passes

## Validation
```bash
node -c lib/commands/feature.js
node -c lib/validation.js
npm test
```

## Technical Approach
- `feature-setup` creates `.aigon/worktree.json` in each worktree with `{ mainRepo: "/abs/path" }`
- `agent-status` reads `.aigon/worktree.json` to find main repo, then uses `writeAgentStatus()` from `lib/manifest.js`
- Remove `updateLogFrontmatterInPlace()` and all YAML frontmatter parsing from `lib/validation.js`
- Log template updated to omit frontmatter block
- `normalizeDashboardStatus()` updated to read from manifest instead of log frontmatter

## Dependencies
- state-manifest-core (needs `writeAgentStatus()` API)

## Out of Scope
- Refactoring CLI command transitions (that's idempotent-outbox-transitions)
- Full dashboard refactor (that's dashboard-manifest-reader)

## Open Questions
- Should existing log files with frontmatter be migrated (strip frontmatter) or left as-is?

## Related
- Research: `docs/specs/research-topics/04-done/research-14-unified-feature-state.md`
- Findings: `docs/specs/research-topics/logs/research-14-cc-findings.md` (Part 4: Worktree Communication)
- Depends on: state-manifest-core
