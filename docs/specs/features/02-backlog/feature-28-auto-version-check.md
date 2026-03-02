# Feature: auto-version-check

## Summary

Automatically check and update Aigon-generated files when an agent session starts. When a user opens Claude, Cursor, or Gemini CLI in a project, a SessionStart hook compares the project's `.aigon/version` against the locally installed CLI version. If they differ, it runs `aigon update` to regenerate command files — eliminating the need to manually visit each repo after upgrading Aigon.

## User Stories
- [ ] As a developer with multiple repos, I want Aigon to auto-update when I start an agent session so I never run stale commands
- [ ] As a developer, I want to see what version Aigon updated from/to so I know something changed

## Acceptance Criteria
- [ ] New `aigon check-version` command exists
- [ ] `check-version` compares `.aigon/version` vs `aigon --version` (local CLI only)
- [ ] If versions match: prints "Aigon is up to date (vX.Y.Z)" and exits 0
- [ ] If versions differ: runs `aigon update` automatically, prints summary of what changed
- [ ] If `.aigon/version` doesn't exist (fresh clone): runs `aigon update`
- [ ] `aigon install-agent cc` writes a SessionStart hook into `.claude/settings.json`
- [ ] `aigon install-agent gg` writes a SessionStart hook into `.gemini/settings.json`
- [ ] `aigon install-agent cu` writes a SessionStart hook into `.cursor/hooks.json` (or equivalent)
- [ ] Hooks are additive — existing hooks in the settings file are preserved
- [ ] `aigon update` continues to call `install-agent` for detected agents (existing behavior), which re-wires hooks if needed
- [ ] Hook only fires on new session start (not resume/compact)

## Validation
```bash
node --check aigon-cli.js
```

## Technical Approach

### Part 1: `check-version` command (~30 lines)

New command in `aigon-cli.js`:

```javascript
'check-version': () => {
    const installed = getInstalledVersion();  // reads .aigon/version
    const current = getAigonVersion();        // reads CLI package.json

    if (!installed || compareVersions(current, installed) !== 0) {
        commands['update']();
    } else {
        console.log(`✅ Aigon is up to date (v${current})`);
    }
}
```

Uses existing functions: `getInstalledVersion()`, `getAigonVersion()`, `compareVersions()`. No new dependencies.

### Part 2: SessionStart hook wiring in `install-agent`

Add a `hooks` section to agent config JSONs (`cc.json`, `gg.json`, `cu.json`):

```json
"extras": {
    "hooks": {
        "enabled": true,
        "path": ".claude/settings.json",
        "sessionStart": {
            "matcher": "startup",
            "command": "aigon check-version",
            "timeout": 30
        }
    }
}
```

The `install-agent` code already reads/merges settings files (lines 6700-6770). Extend this to also write the `hooks.SessionStart` array, following the same additive pattern used for permissions — read existing, merge Aigon's hook in, write back.

### Hook format per agent

**Claude Code** (`.claude/settings.json`):
```json
{
    "hooks": {
        "SessionStart": [{
            "matcher": "startup",
            "hooks": [{
                "type": "command",
                "command": "aigon check-version",
                "timeout": 30
            }]
        }]
    }
}
```

**Gemini CLI** (`.gemini/settings.json`):
```json
{
    "hooks": {
        "SessionStart": [{
            "matcher": "startup",
            "hooks": [{
                "type": "command",
                "command": "aigon check-version",
                "timeout": 30
            }]
        }]
    }
}
```

**Cursor** (`.cursor/hooks.json`):
```json
{
    "hooks": {
        "sessionStart": [{
            "command": "aigon check-version",
            "timeout": 30
        }]
    }
}
```

### Merge strategy for hooks

Follow the same pattern as permissions: read existing settings, check if an Aigon hook already exists (by matching on `"aigon check-version"` in the command string), add it if missing, skip if present.

## Dependencies
- None — uses existing `getInstalledVersion()`, `getAigonVersion()`, `compareVersions()`, and settings-file merge logic

## Out of Scope
- Remote version checking (GitHub, npm registry)
- Version pinning / update policies
- Push model (`aigon update --all`)
- Project registry
- Codex support (no hook system available)

## Open Questions
- Should `check-version` output be quiet (just update silently) or verbose (show changelog)?

## Related
- Research: [research-07-auto-install](../../research-topics/04-done/research-07-auto-install.md)
