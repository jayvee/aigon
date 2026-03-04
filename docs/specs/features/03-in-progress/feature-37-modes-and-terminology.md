# Feature: modes-and-terminology

## Summary

Phase 1 of the terminology revamp: update `aigon-cli.js` to use the new mode names — **Drive, Fleet, Autopilot, Swarm** — in all CLI output, flags, mode detection, and environment variables. This is the foundation that Phase 2 (documentation sweep, feature #38) builds on.

## The Mode Grid

```
                    One Agent          Multi-Agent
                 ┌──────────────┬──────────────────┐
  Hands-on       │    Drive     │     Fleet         │
                 ├──────────────┼──────────────────┤
  Hands-off      │  Autopilot   │     Swarm         │
                 └──────────────┴──────────────────┘
                         Autonomous
```

Two axes:
- **Horizontal**: How many agents? One or many.
- **Vertical**: How involved are you? Hands-on or hands-off.

The bottom row (Autopilot + Swarm) is collectively referred to as **Autonomous** mode.

### Mode definitions

| Mode | Currently called | What it is | Setup |
|------|-----------------|------------|-------|
| **Drive** | "solo mode" | One agent, you're guiding at each stage. The agent writes code; you're driving. | `feature-setup <ID>` or `feature-setup <ID> <agent>` |
| **Fleet** | "arena mode" | Multiple agents in parallel, you observe and guide. Pick the best or cherry-pick from each. | `feature-setup <ID> cc cu gg` |
| **Autopilot** | "Ralph loop" (single) | One agent runs end-to-end autonomously. Implement, validate, retry, submit. You review the output. | `feature-implement <ID> --autonomous` |
| **Swarm** | "Ralph loop" (multi) | Multiple agents run autonomously in parallel. You review results when they converge. | `feature-setup <ID> cc cu gg --autonomous` |

## User Stories

- [ ] As a developer, when I run any Aigon command, the CLI output uses the new mode names (Drive, Fleet, Autopilot, Swarm)
- [ ] As a developer using hooks, `AIGON_MODE` reflects the new values while my existing hooks using old values still work
- [ ] As a developer, I can use `--autonomous` instead of `--ralph` to trigger hands-off mode

## Acceptance Criteria

- [ ] CLI console output uses new terminology: "Drive", "Fleet", "Autopilot", "Swarm" (no user-facing references to "solo mode", "arena mode", "Ralph mode", or "Ralph loop")
- [ ] `--autonomous` flag added to `feature-implement` and `feature-setup`
- [ ] `--ralph` kept as a hidden alias for `--autonomous` (backwards compat)
- [ ] `--autonomous` on `feature-setup` with multiple agents triggers Swarm mode
- [ ] `--autonomous` on `feature-implement` (single agent) triggers Autopilot mode
- [ ] Mode detection logic updated to distinguish all four modes
- [ ] `AIGON_MODE` environment variable values: `drive` | `fleet` | `autopilot` | `swarm` (old values `solo` | `arena` resolve correctly via aliases)
- [ ] Board display updated: `[F]` = Fleet, `[AP]` = Autopilot, `[S]` = Swarm (Drive is default, no indicator)
- [ ] help command output describes all four modes with one-line summaries
- [ ] Console emoji updated: `🚗 Drive` | `🚛 Fleet` | `✈️ Autopilot` | `🐝 Swarm`

## Validation

```bash
# Syntax check
node --check aigon-cli.js

# Verify old user-facing terms are gone from CLI output strings (console.log/warn/error)
# Allow: comments, variable names, alias mappings, CHANGELOG, done specs, and log files
! grep -n 'solo mode\|solo branch\|arena mode\|Ralph mode\|Ralph loop' aigon-cli.js | grep -v '^\s*//' | grep -v 'alias\|legacy\|compat\|fallback\|CHANGELOG' | grep -q 'console\.\|println\|chalk\.'

# Verify --ralph alias still works (backwards compat)
node -e "const s = require('fs').readFileSync('aigon-cli.js','utf8'); if(!s.includes('ralph')) { process.exit(1); }"
```

## Technical Approach

### Scope: `aigon-cli.js` only

This feature touches ONE file: `aigon-cli.js`. All documentation changes are in feature #38.

### Changes needed

1. **Add `--autonomous` flag** to `feature-implement` and `feature-setup` argument parsing (alias `--ralph`)
2. **Update mode detection logic** — currently `isArenaMode` boolean; needs to become four-state: `drive | fleet | autopilot | swarm`
3. **Update `AIGON_MODE`** values passed to hooks, with alias resolution for old values
4. **Update all console output strings** (~150 lines) — replace "solo"/"arena"/"Ralph" with new mode names
5. **Update board display** — new indicators `[F]`, `[AP]`, `[S]`
6. **Update help output** — four mode summaries

### Naming conventions in code

| Context | Format | Example |
|---------|--------|---------|
| CLI output | Capitalised | `Drive mode`, `Fleet mode`, `Autopilot mode`, `Swarm mode` |
| Environment variable | lowercase | `AIGON_MODE=drive` |
| Internal code | camelCase | `isDriveMode`, `isFleetMode`, `isAutopilotMode`, `isSwarmMode` |
| Board indicators | Bracketed | `[F]`, `[AP]`, `[S]` |
| Collective term | Title case | "Autonomous" (covers Autopilot + Swarm) |

### Migration: keeping things working

- `--ralph` → hidden alias for `--autonomous`
- `AIGON_MODE=solo` → resolves to `drive` in hooks
- `AIGON_MODE=arena` → resolves to `fleet` in hooks
- Old board indicators (`[2]`, `[wt]`) → replaced with `[F]`, `[AP]`, `[S]`
- No breaking changes to git worktree naming patterns (internal, not user-facing)

## Dependencies

- None. This is the foundation for feature #38 (docs sweep) and the aigon-site terminology feature.

## Out of Scope

- README, GUIDE, command templates, docs (feature #38)
- Website / aigon-site changes (separate aigon-site feature)
- VS Code extension terminology
- Git worktree directory naming conventions
- New functionality beyond the terminology rename

## Open Questions

- Should "solo worktree" retain a `[wt]` indicator alongside Drive, or drop it?
- Should the board show agent count alongside mode? e.g., `[F3]` for 3-agent Fleet?

## Related

- **Feature #38**: modes-docs-sweep (Phase 2 — documentation, depends on this)
- Feature: deploy-demo-update (aigon-site — website terminology)
- Feature: agent-cost-awareness (modes inform cost)
- Feature #02: unify-workflow (previous rename: "bakeoff" → "arena")
- Feature #16: ralph-wiggum (original autonomous loop)
- Feature #35: ralph-auto-submit (Autopilot auto-submit behaviour)
