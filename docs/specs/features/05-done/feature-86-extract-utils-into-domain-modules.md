# Feature: extract-utils-into-domain-modules

## Summary
Split `lib/utils.js` (6,500 lines, 198 functions, 217 exports) into focused domain modules. Each module owns its functions, constants, and state — making changes local, tests targeted, and dependencies explicit. This is the foundational refactor that enables all future simplification.

## User Stories
- [ ] As a developer, I want to change proxy logic without scrolling past 1,200 lines of AIGON server code
- [ ] As a developer, I want each module to have clear boundaries so I know where to add new functionality
- [ ] As a contributor, I want architecture docs that match the actual module structure

## Acceptance Criteria
- [ ] `lib/proxy.js` extracted (~600 lines): Caddy management, dnsmasq detection, port allocation, registry read/write, route reconciliation, Caddyfile generation
- [ ] `lib/dashboard-server.js` extracted (~1,200 lines): HTTP server, polling, WebSocket relay, notification system, action dispatch, dashboard HTML builder
- [ ] `lib/worktree.js` expanded (~800 lines): worktree creation, permissions, trust, tmux session management, terminal launching (iTerm2, Warp, etc.)
- [ ] `lib/config.js` expanded (~400 lines): global/project config load/save, profile detection, agent CLI config, editor detection
- [ ] `lib/templates.js` expanded (~300 lines): template reading, processing, scaffolding, content generation
- [ ] `lib/utils.js` reduced to under 2,000 lines — only truly shared utilities remain (slugify, parseCliOptions, etc.)
- [ ] Each extracted module has its own `require()` imports — no circular dependencies
- [ ] All modules export via `module.exports` with documented interfaces
- [ ] `lib/errors.js` helpers (from Feature A) used in all new modules
- [ ] Dead exports removed: `addCaddyRoute`, `removeCaddyRoute`, `isCaddyAdminAvailable`, `writeCaddyfileBackup`
- [ ] `utils.js` re-exports new modules for backward compatibility during transition (to avoid breaking the scope destructuring before Feature C)
- [ ] All existing 155+ tests pass
- [ ] New test file per extracted module (at minimum, verify exports and basic smoke tests)
- [ ] README.md architecture section updated with new module map
- [ ] GUIDE.md updated: reference new module structure in "contributing" or "how it works" sections
- [ ] `docs/dashboard.md` updated: reference `dashboard-server.js` instead of "functions in utils.js"
- [ ] `CLAUDE.md` updated: reflect new module locations in "Key Functions" section

## Validation
```bash
node -c lib/utils.js
node -c lib/proxy.js
node -c lib/dashboard-server.js
node -c lib/worktree.js
node -c lib/config.js
node -c lib/templates.js
node --test aigon-cli.test.js
# Verify utils.js is under 2000 lines
test $(wc -l < lib/utils.js) -lt 2000
# Verify no circular dependencies
node -e "require('./lib/proxy'); require('./lib/dashboard-server'); require('./lib/worktree'); require('./lib/config'); require('./lib/templates'); console.log('No circular deps')"
```

## Technical Approach

### Extraction order (each step leaves tests green)
1. **proxy.js** — cleanest boundary: port allocation, Caddy, dnsmasq, registry. No dependency on dashboard or commands.
2. **config.js** — global/project config, profiles, agent config. Used by everything but depends on nothing.
3. **templates.js** — template reading, processing, placeholders. Self-contained.
4. **worktree.js** — worktree creation, permissions, tmux. Depends on git.js and config.js.
5. **dashboard-server.js** — the HTTP server, polling, notifications. Depends on proxy.js, config.js, git.js. This is the biggest extraction.

### Migration strategy
- Extract functions into new module
- Add `require('./new-module')` to utils.js
- Re-export from utils.js for backward compatibility: `module.exports = { ...proxy, ...config, ...ownFunctions }`
- This means shared.js continues to work unchanged during this feature
- Feature C (restructure command system) will remove the re-exports

### State ownership
Each module owns its state files:
- `proxy.js` owns `~/.aigon/dev-proxy/servers.json` and `~/.aigon/dev-proxy/Caddyfile`
- `config.js` owns `~/.aigon/config.json` and `.aigon/config.json`
- `dashboard-server.js` owns `~/.aigon/dashboard.log`

## Dependencies
- Feature A (error-handling-and-state-validation) — should be done first so new modules use structured error handling from the start

## Out of Scope
- Restructuring the command system (Feature C)
- Changing the `createAllCommands` scope pattern (Feature C)
- Async refactoring
- Adding new functionality — this is purely structural

## Open Questions
- Should `lib/analytics.js` be extracted separately? (~400 lines of `collectAnalyticsData` and related functions)
- Should the thin re-export in `lib/dashboard.js` be merged into `lib/dashboard-server.js`?

## Related
- Feature 82: consolidate-git-helpers (completed — established the extraction pattern)
- Feature A: error-handling-and-state-validation (prerequisite)
- Feature C: restructure-command-system (depends on this)
