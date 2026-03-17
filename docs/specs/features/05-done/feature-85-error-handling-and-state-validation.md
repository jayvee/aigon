# Feature: error-handling-and-state-validation

## Summary
Replace 120+ silent `catch (e) { /* ignore */ }` blocks with structured error handling, and consolidate state files (merge `ports.json` into `servers.json`) with startup validation. This is the first step in the architectural simplification — it directly addresses the "silently wrong" class of bugs (like `.env.local` blocking operations, stale registry entries, phantom processes) that make aigon feel flaky.

## User Stories
- [ ] As a user, when the dashboard shows wrong data, I want to see WHY in the log instead of silently wrong output
- [ ] As a user, I want stale processes and dead registry entries to be cleaned up automatically on dashboard startup
- [ ] As a developer, I want config parse failures to warn me instead of silently reverting to defaults

## Acceptance Criteria
- [ ] New `lib/errors.js` module with `tryOrDefault(fn, default, opts)` and `classifyError(e)` helpers
- [ ] All JSON parse catches in utils.js use `tryOrDefault` with warning on parse failure (not silent)
- [ ] All file read catches distinguish ENOENT (expected, silent) from EACCES/other (warn)
- [ ] All git command catches propagate meaningful errors to callers
- [ ] `ports.json` eliminated — port data merged into `servers.json`
- [ ] `validateRegistry()` function runs on dashboard startup: verifies PIDs alive, ports listening, removes stale entries
- [ ] Dashboard startup log shows validation summary (e.g. "Registry: 3 live, 1 stale removed")
- [ ] Silent catch count reduced from 120+ to under 30 (remaining are genuine probes like `caddy version`)
- [ ] All existing 155+ tests pass
- [ ] README.md updated: remove references to `ports.json`, document error logging
- [ ] GUIDE.md updated: add troubleshooting section about checking `~/.aigon/dashboard.log` for errors
- [ ] `docs/dashboard.md` updated: document the startup validation and error reporting

## Validation
```bash
node -c lib/utils.js
node -c lib/errors.js
node --test aigon-cli.test.js
# Count remaining silent catches — should be under 30
grep -r "catch.*ignore\|catch.*{.*}" lib/ --include="*.js" | grep -v node_modules | grep -v "// probe\|// detection\|// optional" | wc -l
```

## Technical Approach

### Phase 1: Create lib/errors.js
```js
function tryOrDefault(fn, defaultValue, { warn = false, context = '' } = {}) {
    try { return fn(); }
    catch (e) {
        if (warn) log(`[${context}] ${e.message}`);
        return defaultValue;
    }
}

function classifyError(e) {
    if (e.code === 'ENOENT') return 'missing';     // File doesn't exist — expected
    if (e.code === 'EACCES') return 'permission';   // Permission denied — bug
    if (e instanceof SyntaxError) return 'parse';    // JSON/YAML parse — corruption
    return 'unknown';
}
```

### Phase 2: Classify and replace catches
- **Probe catches** (30): Keep as-is, add `// probe` comment for grep filtering
- **Parse catches** (40): Replace with `tryOrDefault(..., {}, { warn: true, context: 'global config' })`
- **File I/O catches** (20): Use `classifyError` — ENOENT silent, others warn
- **Git/tmux catches** (30): Propagate to caller or use tryOrDefault with warning

### Phase 3: State consolidation
- Merge `ports.json` data into `servers.json` (both track the same apps)
- Add `validateRegistry()` that checks PID liveness and port availability
- Call it from `runDashboardServer()` before starting the HTTP server

## Dependencies
- None — can be done independently of other refactoring features

## Out of Scope
- Splitting utils.js into modules (Feature B)
- Restructuring the command system (Feature C)
- Adding retry logic or circuit breakers
- Changing the async model (everything stays synchronous)

## Open Questions
- Should `validateRegistry()` also check if Caddy routes match the registry? (adds complexity but catches more drift)

## Related
- Feature 82: consolidate-git-helpers (completed — established the pattern of extracting modules)
- Feature 83: remove-radar-dead-code (completed — cleaned up dead code)
- Feedback: [.env.local should not block feature-close](memory/feedback_env_local_ignored.md)
