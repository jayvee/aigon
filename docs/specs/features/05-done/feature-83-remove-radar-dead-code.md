# Feature: remove-radar-dead-code

## Summary
Remove all dead `radar` code and references from the codebase. Radar was the predecessor to the dashboard — it's been deprecated since the dashboard replaced it, but ~30 references remain across comments, function names, variable names, and the deprecated `radar` command stub. Also document the `conductor` command which IS active but missing from architecture docs.

## User Stories
- [ ] As a developer, I want no dead code paths so I don't waste time investigating deprecated functions
- [ ] As a contributor, I want architecture docs that reflect reality — including the conductor

## Acceptance Criteria
- [ ] `aigon radar` command removed entirely (currently just prints deprecation warning)
- [ ] All comments referencing "radar" updated or removed
- [ ] `detectRadarContext()` removed if unused outside radar
- [ ] `RADAR_DEFAULT_PORT`, `RADAR_DYNAMIC_PORT_START` constants removed
- [ ] Any radar-specific dev-proxy cleanup code removed
- [ ] `conductor` command documented in architecture/help
- [ ] Memory file `reference_radar_dashboard_architecture.md` updated to remove radar references
- [ ] All 156+ existing tests pass
- [ ] All README, GUIDE, and documentation files purged of radar references
- [ ] `grep -ri radar lib/ templates/ docs/ README* GUIDE* AGENTS* | grep -v node_modules` returns zero hits

## Validation
```bash
node -c lib/utils.js
node -c lib/commands/shared.js
node --test aigon-cli.test.js
grep -ri "radar" lib/ templates/ | grep -v node_modules | grep -c . | xargs test 0 -eq
```

## Technical Approach
1. Audit all `radar` references: commands, constants, functions, comments
2. Remove the deprecated `radar` command and its supporting code
3. Clean up constants (`RADAR_DEFAULT_PORT`, etc.)
4. Remove `detectRadarContext()` if only used by radar
5. Update comments that reference radar to say dashboard
6. Add conductor to the help output and any architecture docs
7. Update memory files that reference the old radar architecture

## Dependencies
- None

## Out of Scope
- Refactoring the conductor command itself
- Refactoring the dashboard (that's working fine now)
- Feature 82 (git helpers consolidation) — independent work

## Open Questions
- None

## Related
- Memory: [Radar/Dashboard Architecture](../../../.claude/projects/-Users-jviner-src-aigon/memory/reference_radar_dashboard_architecture.md)
- The dashboard (`aigon dashboard`) is the active replacement
- The conductor (`aigon conductor`) is active and should be documented
