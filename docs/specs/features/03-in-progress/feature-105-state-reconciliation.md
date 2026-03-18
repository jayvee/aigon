# Feature: state-reconciliation

## Summary
Add desync detection and repair to `aigon doctor`, and flatten the log directory structure by eliminating `logs/selected/` and `logs/alternatives/` folders. The reconciler compares manifests against actual system state (folders, worktrees, processes) and either auto-repairs or flags issues. Absorbs drop-selected-alternatives.

## User Stories
- [ ] As a user, `aigon doctor` tells me when a feature's manifest disagrees with its folder position and offers to fix it
- [ ] As a user, `aigon doctor` detects orphaned worktrees, dead tmux sessions, and stuck pending operations
- [ ] As a user, log files are all in a flat `logs/` directory — no `selected/`/`alternatives/` subfolders

## Acceptance Criteria
- [ ] `aigon doctor` checks: manifest stage vs folder position, manifest agents vs worktree existence, pending ops that are stale (>1hr old), agent status files for features that are already closed
- [ ] Each desync has a named check (e.g., `stage-mismatch`, `orphaned-worktree`, `stale-pending`, `dead-agent`)
- [ ] Auto-repair for safe cases: correct manifest stage to match folder, clean up stale locks, remove agent status files for closed features
- [ ] Warning (no auto-repair) for unsafe cases: pending ops with uncommitted changes, folder/manifest disagree and both have been modified
- [ ] `organizeLogFiles()` removed — log files stay flat in `logs/`
- [ ] Winner recorded in coordinator manifest `winner` field, not by folder structure
- [ ] `npm test` passes

## Validation
```bash
node -c lib/commands/setup.js
npm test
```

## Technical Approach
- Add reconciliation checks to existing `doctor` command in `lib/commands/setup.js`
- Each check: read manifest, probe reality (folder, worktree, tmux), compare, report or fix
- Remove `organizeLogFiles()` from `feature-close` — logs stay in `logs/`, winner set in manifest
- Migration: if `logs/selected/` or `logs/alternatives/` exist, move files back to `logs/` during doctor

## Dependencies
- state-manifest-core (needs manifest read API)
- idempotent-outbox-transitions (reconciler needs idempotent ops to safely repair state)

## Out of Scope
- Automatic scheduled reconciliation (manual `aigon doctor` for now)
- Dashboard UI for desync warnings

## Open Questions
- Should `aigon doctor --fix` auto-repair all safe cases, or require per-check confirmation?

## Related
- Research: `docs/specs/research-topics/04-done/research-14-unified-feature-state.md`
- Findings: `docs/specs/research-topics/logs/research-14-cc-findings.md` (Part 2: desync scenarios, Part 6: directory structure)
- Depends on: state-manifest-core, idempotent-outbox-transitions
