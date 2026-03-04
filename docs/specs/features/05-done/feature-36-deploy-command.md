# Feature: deploy-command

## Summary

Add `aigon deploy` and `aigon deploy --preview` as first-class CLI commands, completing the end-to-end autonomous workflow: `feature-create` → `feature-prioritise` → `feature-setup` → `feature-implement --ralph --auto-submit` → `feature-done` → `deploy`. The deploy command runs a user-configured shell command (or auto-detects from `package.json` scripts) so it works with any deployment target — Vercel, Fly, AWS, custom scripts — without Aigon needing to know the specifics.

## User Stories

- [ ] As a developer, I can run the entire feature lifecycle from idea to production without leaving the command line
- [ ] As a developer using Vercel, I configure `"deploy": "vercel --prod"` once in `.aigon/config.json` and `aigon deploy` handles the rest
- [ ] As a developer with a `deploy` script in `package.json`, `aigon deploy` works with zero Aigon config
- [ ] As a developer, I can optionally have `feature-done` automatically deploy after merging by setting `workflow.deployAfterDone: true`
- [ ] As an agent implementing a feature, I can call `aigon deploy` without knowing the project's specific deployment toolchain

## Acceptance Criteria

- [ ] `aigon deploy` runs the command from `commands.deploy` in `.aigon/config.json`
- [ ] `aigon deploy --preview` runs the command from `commands.preview` in `.aigon/config.json`
- [ ] If no `.aigon/config.json` deploy command exists, falls back to `npm run deploy` / `npm run preview` if those scripts exist in `package.json`
- [ ] If neither is configured, prints a clear setup message explaining how to add it and exits 1
- [ ] stdout/stderr from the deploy command streams directly to the terminal (not buffered)
- [ ] The deploy command's exit code is propagated — `aigon deploy` exits non-zero if the deploy fails
- [ ] When `workflow.deployAfterDone: true` is set in `.aigon/config.json`, `aigon feature-done` automatically calls `aigon deploy` after a successful merge
- [ ] If `deployAfterDone` deploy fails, the failure is reported clearly but the merge is NOT rolled back
- [ ] `aigon deploy` appears in `aigon help` output and `COMMAND_ARG_HINTS`
- [ ] `node --check aigon-cli.js` passes

## Validation

```bash
node --check aigon-cli.js
```

## Technical Approach

### Configuration

`.aigon/config.json`:
```json
{
  "profile": "web",
  "commands": {
    "deploy": "vercel --prod",
    "preview": "vercel"
  },
  "workflow": {
    "deployAfterDone": false
  }
}
```

### Command resolution (checked in order)

1. `.aigon/config.json` → `commands.deploy` (or `commands.preview` for `--preview`)
2. `package.json` → `scripts.deploy` (or `scripts.preview`) — read with `JSON.parse(fs.readFileSync('package.json'))`
3. Nothing found → print setup instructions and `process.exitCode = 1`

### Execution

```js
spawnSync(resolvedCommand, { stdio: 'inherit', shell: true })
```

`stdio: 'inherit'` streams output directly to the terminal and propagates Ctrl+C correctly.

### feature-done integration

After successful merge, check `loadProjectConfig()?.workflow?.deployAfterDone`. If true, resolve and run the deploy command. Print a clear separator:

```
✅ Feature 36 complete! (solo mode)

🚀 Deploying (deployAfterDone)...
→ vercel --prod
[vercel output streams here]
✅ Deployed.
```

If the deploy fails, print the error and exit non-zero — but do NOT roll back the merge.

### Help

Add to `COMMAND_ARG_HINTS`:
```js
'deploy': '[--preview]',
```

Add to CLI help under a `Deploy` section:
```
Deploy:
  deploy [--preview]    Run the configured deploy command
```

## Dependencies

- `loadProjectConfig()` — already reads `.aigon/config.json`
- `feature-done` command — integration point for `deployAfterDone`

## Out of Scope

- Tier 2 / Tier 3 commands (`db:migrate`, arbitrary user-defined aliases) — separate feature
- Rollback on deploy failure
- Deploy status tracking or notifications
- CI/CD pipeline integration

## Open Questions

-

## Related

- Feature: conductor-daemon (could notify when deploy completes)
- Config: `.aigon/config.json` profile system
