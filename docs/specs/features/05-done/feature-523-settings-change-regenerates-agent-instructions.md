---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-12T06:14:46.293Z", actor: "cli/feature-prioritise" }
---

# Feature: settings-change-regenerates-agent-instructions

## Summary

Certain settings in `.aigon/config.json` — `profile`, `devServer.enabled`, `instructions.rigor`, `instructions.testing`, `instructions.logging`, `instructions.planMode`, `instructions.documentation` — are baked into the agent command files (e.g. `.claude/commands/aigon/feature-do.md`) at `install-agent` time. Changing them has no effect until the user manually runs `aigon install-agent --all` and commits. The dashboard gives no indication this is required, so the change silently does nothing. This feature makes the setting change actually take effect: when any bake-affecting setting changes (via dashboard or CLI), automatically re-run `install-agent --all` for that repo and commit the regenerated commands.

## User Stories

- [ ] As a user who toggles `devServer.enabled` in the dashboard, I want the agent instructions to immediately reflect that — without needing to know about `install-agent`
- [ ] As a user who changes `instructions.rigor` from `light` to `production` in config, I want future feature agents to get full test and logging instructions automatically
- [ ] As a user who changes `profile`, I want the correct test instructions, dep-check steps, and env setup to be baked into agent commands immediately

## Acceptance Criteria

- [ ] After saving `devServer.enabled`, `profile`, `instructions.rigor`, `instructions.testing`, `instructions.logging`, `instructions.planMode`, or `instructions.documentation` via the dashboard, `install-agent --all` runs automatically for that repo and changes are committed
- [ ] After setting any of the above keys via `aigon config set <key> <value>`, the same regeneration + commit happens
- [ ] The commit message is `chore(install): regenerate agent instructions after settings change`
- [ ] A toast in the dashboard confirms: "Agent instructions regenerated" (or an error if it fails)
- [ ] Settings that do NOT affect baked commands (agent models, security, autoNudge, terminalApp) do NOT trigger regeneration
- [ ] If the repo has no install manifest (never had `install-agent` run), skip silently — no error

## Validation

```bash
node -e "
const { DASHBOARD_SETTINGS_SCHEMA } = require('./lib/dashboard-server.js');
const baked = DASHBOARD_SETTINGS_SCHEMA.filter(s => s.affectsInstalledCommands);
console.assert(baked.length > 0, 'No baked settings flagged');
console.assert(baked.some(s => s.key === 'devServer.enabled'), 'devServer.enabled not flagged');
console.assert(baked.some(s => s.key === 'profile'), 'profile not flagged');
console.log('OK:', baked.map(s => s.key).join(', '));
"
```

## Technical Approach

**Schema flag:** Add `affectsInstalledCommands: true` to the relevant entries in `DASHBOARD_SETTINGS_SCHEMA` in `lib/dashboard-server.js`. This is the single source of truth for which settings trigger regeneration — no hardcoded key lists elsewhere.

Affected keys: `profile`, `devServer.enabled`, `instructions.rigor`, `instructions.testing`, `instructions.logging`, `instructions.planMode`, `instructions.documentation`, `instructions.devServer`.

Note: `instructions.*` keys are not currently in the dashboard schema — they're config-only. Flag them anyway so CLI coverage is correct; the dashboard simply won't encounter them.

**Dashboard path (`PUT /api/settings`):** After a successful write, check `settingDef.affectsInstalledCommands`. If true, spawn `aigon install-agent --all` in `repoPath` as a child process, wait for it, then run `git add -A && git commit -m "chore(install): regenerate agent instructions after settings change"` in that repo. Return the existing 200 response immediately (don't block on the regeneration) — or block and include `{ regenerated: true }` in the response body. Prefer blocking so the toast reflects reality.

**CLI path (`aigon config set`):** `aigon config set` lives in `lib/commands/setup.js`. After writing the config key, if the key is in the set of `affectsInstalledCommands` keys (derive from the schema), run the same install + commit sequence in `process.cwd()`.

**Install-manifest guard:** Before running install-agent, check for `.aigon/install-manifest.json` in the repo. Skip if missing — the user hasn't installed agents yet and there's nothing to regenerate.

**Commit authorship:** Use the existing git commit path (same as `feature-close` and install-agent itself). No `--no-verify`.

## Dependencies

- None

## Out of Scope

- Propagating the regeneration to existing open worktrees (worktrees have their own committed branch; the user needs to re-run `/feature-do` or close and re-open)
- Watching config files for changes outside the dashboard/CLI (filesystem watchers)
- Per-agent selective regeneration — always regenerate all installed agents; partial installs are not worth the complexity

## Open Questions

- Should the CLI path block (synchronous) or spawn-and-forget? Blocking is safer but slows `aigon config set`. Given the operation is rare, blocking is fine.

## Related

- Research: none
- Set: none
