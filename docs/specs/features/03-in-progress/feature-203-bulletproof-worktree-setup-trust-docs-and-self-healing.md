# Feature: Bulletproof Worktree Setup — Trust, Docs, and Self-Healing

## Summary

Move worktrees from `../{reponame}-worktrees/` (sibling directory, unique to aigon, surprises users) to `~/.aigon/worktrees/{reponame}/` (home directory, matches Cursor and Codex conventions). Make the setup seamless: `aigon init` creates the directory and trusts it for all agents, every agent launch self-heals trust, and docs explain the concept before users encounter it.

## Context: Industry Research

| Tool | Worktree Location |
|------|------------------|
| Claude Code | `<repo>/.claude/worktrees/` (inside repo dotfolder) |
| Cursor | `~/.cursor/worktrees/<repo>/` (home directory) |
| Codex | `~/.codex/worktrees/` (home directory) |
| Aigon (current) | `../{reponame}-worktrees/` (sibling — nobody else does this) |

**Decision: `~/.aigon/worktrees/{reponame}/`** — home directory approach, matching Cursor and Codex. Reasons:
- Zero risk of agents scanning worktree files (completely outside repo tree)
- No gitignore complexity
- No surprise sibling directories cluttering `~/src/`
- Self-contained under `~/.aigon/` alongside global config and backups
- If repo is renamed, old worktrees remain but `aigon doctor` can detect and clean up

## The Problems This Solves

1. **Trust prompts on every launch** — agents don't trust the sibling worktree directory
2. **Mysterious sibling directories** — `brewboard-worktrees/` appearing next to `brewboard/` with no explanation
3. **No setup during init** — worktree directory created ad-hoc on first `feature-start`
4. **No self-healing** — once trust is lost, every launch fails until manually fixed
5. **Global config wipeout** — added `saveGlobalConfig()` guard (done), but also need auto-restore on corrupt load

## User Stories

- [ ] As a new user, I want `aigon init` to tell me where worktrees will be stored and set everything up
- [ ] As a user, I want agents to never show trust prompts
- [ ] As a user who renames their repo, I want `aigon doctor` to detect orphaned worktrees and clean up

## Acceptance Criteria

### Move worktrees to ~/.aigon/worktrees/{reponame}/
- [ ] `getWorktreeBase()` returns `~/.aigon/worktrees/{reponame}` instead of `../{reponame}-worktrees`
- [ ] `feature-start` creates worktrees under the new location
- [ ] `feature-close` removes worktrees from the new location
- [ ] Existing sibling worktrees still work (backward compatible detection)
- [ ] Migration: `aigon doctor --fix` moves existing sibling worktrees to the new location

### aigon init handles worktree setup
- [ ] `aigon init` creates `~/.aigon/worktrees/{reponame}/` directory
- [ ] `aigon init` tells the user: "Worktrees: ~/.aigon/worktrees/{reponame}/"
- [ ] `aigon init` pre-trusts the directory for all installed agents

### Self-healing trust on every launch
- [ ] `buildAgentCommand()` shell wrapper calls `aigon trust-worktree "$(pwd)"` before launching
- [ ] New command `aigon trust-worktree <path>` calls `ensureAgentTrust()` for all installed agents — idempotent, fast
- [ ] If trust fails, clear error message instead of interactive prompt

### Global config protection
- [ ] `saveGlobalConfig()` refuses to write empty/corrupt configs (done ✓)
- [ ] `loadGlobalConfig()` detects empty/corrupt config and auto-restores from `config.latest.json`
- [ ] New command `aigon config restore` lists backups and restores selected one

### Documentation
- [ ] Getting started docs explain worktrees: "Aigon stores working copies in ~/.aigon/worktrees/{project}/ when you use parallel agent development"
- [ ] `aigon doctor` checks worktree directory exists and is trusted

### Cleanup
- [ ] `aigon doctor --fix` prunes worktrees for completed features
- [ ] `aigon doctor --fix` detects repo renames (worktree dir doesn't match any registered repo) and offers cleanup

## Validation

```bash
node -c aigon-cli.js
node -c lib/worktree.js

# Worktree base is under ~/.aigon/
node -e "
const { getWorktreeBase } = require('./lib/worktree');
const base = getWorktreeBase();
if (!base.includes('.aigon/worktrees')) { console.error('FAIL:', base); process.exit(1); }
console.log('PASS:', base);
"
```

## Technical Approach

### 1. Change `getWorktreeBase()`

```js
function getWorktreeBase() {
    const repoName = path.basename(process.cwd());
    return path.join(os.homedir(), '.aigon', 'worktrees', repoName);
}
```

### 2. Backward compatibility

On `feature-start`, check both new and old locations. On `feature-close`, clean from wherever the worktree actually is. `findWorktrees()` scans both locations during the transition period.

### 3. Extend `aigon init`

```js
// After creating docs/specs/ structure:
const wtBase = getWorktreeBase();
fs.mkdirSync(wtBase, { recursive: true });
ensureAgentTrust(wtBase);
console.log(`📂 Worktrees: ${wtBase}`);
```

### 4. Self-healing shell wrapper

Add to `buildAgentCommand()` before the agent CLI launch:
```bash
aigon trust-worktree "$(pwd)" 2>/dev/null || true
```

### 5. Config auto-restore

In `loadGlobalConfig()`:
```js
if (configExists) {
    const raw = fs.readFileSync(GLOBAL_CONFIG_PATH, 'utf8').trim();
    if (!raw || raw === '{}' || raw === 'null') {
        // Corrupt — try restore
        if (fs.existsSync(GLOBAL_CONFIG_BACKUP_LATEST_PATH)) {
            fs.copyFileSync(GLOBAL_CONFIG_BACKUP_LATEST_PATH, GLOBAL_CONFIG_PATH);
            console.warn('⚠️  Global config was corrupt — restored from backup');
        }
    }
}
```

### Key files:
- `lib/worktree.js` — change `getWorktreeBase()`
- `lib/commands/setup.js` — extend init, add trust-worktree command, add config restore
- `lib/config.js` — add auto-restore on corrupt load
- `docs/getting-started.md` — document worktrees

## Dependencies

- depends_on: pluggable-agent-architecture (201, done)

## Out of Scope

- Making worktree location user-configurable (can add later if needed)
- Worktree-level `.env` management (separate concern)
- Changing how git worktrees work internally

## Related

- Feature 201: Pluggable Agent Architecture (provides ensureAgentTrust)
- Research 28: Gemini CLI Worktree Sandbox (Gemini's sandbox is a separate issue)
- The trust prompt bug on brewboard f07 that triggered this investigation
