# Feature: state-manifest-core

## Summary
Introduce per-feature JSON manifests in `.aigon/state/` as the authoritative local state record. Includes coordinator manifest (`feature-{id}.json`) + per-agent status files (`feature-{id}-{agent}.json`), a read/write API module, advisory file locking, lazy bootstrap from existing folder/log state, and event audit trail. This is the foundation for the entire unified state architecture.

## User Stories
- [ ] As a CLI command, I can read a single manifest file to know a feature's stage, agents, and pending operations instead of assembling from 5 signals
- [ ] As an agent, I can write my status to a dedicated file in the main repo without conflicting with other agents
- [ ] As a developer, I can inspect `.aigon/state/feature-55.json` to understand the full state of a feature
- [ ] As a user running `feature-setup` on a feature that was manually created in `01-inbox/`, the manifest bootstraps automatically on first access

## Acceptance Criteria
- [ ] `.aigon/state/` directory is gitignored
- [ ] `lib/manifest.js` module exports: `readManifest(id)`, `writeManifest(id, data)`, `readAgentStatus(id, agent)`, `writeAgentStatus(id, agent, data)`, `acquireLock(id)`, `releaseLock(id)`
- [ ] Coordinator manifest schema: `{ id, type, name, stage, specPath, agents, winner, pending, events }`
- [ ] Per-agent status schema: `{ agent, status, updatedAt, worktreePath }`
- [ ] Lazy bootstrap: if `readManifest(id)` finds no file, it creates one from folder position + log frontmatter + worktree probing
- [ ] Events array records all state changes with `{ type, at, actor }` entries
- [ ] Advisory file locking via `.aigon/locks/feature-{id}.lock` prevents concurrent mutations
- [ ] Lock auto-releases on process exit (flock-based or PID-based with stale detection)
- [ ] `node -c lib/manifest.js` passes syntax check
- [ ] Existing tests continue to pass (`npm test`)

## Validation
```bash
node -c lib/manifest.js
npm test
```

## Technical Approach
- New module `lib/manifest.js` — all manifest I/O in one place
- JSON files (not YAML) for machine readability and atomic `JSON.parse`/`JSON.stringify`
- Lazy bootstrap pattern: any `readManifest()` call checks for file existence, creates from derived state if missing
- Locking: `fs.openSync` with `O_EXCL` for lock creation, PID written inside for stale detection
- `.aigon/state/` added to `.gitignore`
- Folder position remains the shared ground truth — manifest caches stage locally. If they disagree, folder wins and manifest is corrected

## Dependencies
- None (foundation feature)

## Out of Scope
- Refactoring existing commands to use manifests (that's idempotent-outbox-transitions)
- Agent write path changes (that's agent-status-out-of-worktree)
- Dashboard refactoring (that's dashboard-manifest-reader)
- Desync detection/repair (that's state-reconciliation)

## Open Questions
- Should manifests include a schema version field for future migration?

## Related
- Research: `docs/specs/research-topics/04-done/research-14-unified-feature-state.md`
- Findings: `docs/specs/research-topics/logs/research-14-cc-findings.md` (Part 4-6)
- Phase 2 dependents: idempotent-outbox-transitions, agent-status-out-of-worktree, dashboard-manifest-reader
