# Feature: smart-update-from-origin

## Summary

Make `aigon update` (and `check-version`) aware of the aigon source repo's remote origin. Today, updating aigon is a two-step process that users must remember: (1) `cd ~/src/aigon && git pull` to update the CLI, then (2) `aigon update` in each project to sync templates. This feature unifies the flow — when `check-version` or `update` runs inside a target repo like brewboard, it first checks whether the local aigon source is behind its GitHub origin, and offers to pull before proceeding.

## Terminology

This feature introduces clear terminology to avoid confusion:

- **CLI upgrade** — updating the aigon source code itself (`~/src/aigon`) from GitHub. This changes the CLI binary, lib modules, and templates.
- **Project sync** — updating a target repo's aigon files (templates, agent configs, docs) to match the installed CLI version. This is what `aigon update` does today.

The user-facing messaging should use these terms consistently.

## User Stories

- [ ] As a user running `aigon update` in brewboard, I want to be told if my local aigon CLI is behind GitHub origin, so I don't have to remember to check separately
- [ ] As a user, I want the option to pull the latest aigon CLI automatically before syncing my project, so the whole update is one step
- [ ] As a user running in a CI/non-interactive context, I want the pull to happen automatically without prompts (via `--yes` flag)

## Acceptance Criteria

- [ ] `check-version` (SessionStart hook) compares local aigon HEAD against `origin/main` and reports if behind
- [ ] When behind, prints a clear message: "Aigon CLI is X commits behind origin. Run `aigon update --pull` to upgrade CLI and sync this project."
- [ ] `aigon update --pull` runs `git pull && npm install` in the aigon source dir (`ROOT_DIR`), then proceeds with normal project sync
- [ ] `aigon update` (without `--pull`) continues to work as today — project sync only, but prints a warning if CLI is behind origin
- [ ] If aigon source has no remote (e.g. local-only development), the origin check is silently skipped
- [ ] If `git fetch` fails (offline, auth error), warn and continue with project sync
- [ ] Dashboard restart still happens after update (existing behaviour preserved)
- [ ] User-facing messages use "CLI upgrade" and "project sync" terminology consistently

## Validation

```bash
node --check aigon-cli.js
node --check lib/commands/setup.js
```

## Technical Approach

1. **Add `getAigonRemoteVersion()` to `lib/utils.js`** — runs `git fetch origin --quiet` then `git rev-list HEAD..origin/main --count` in `ROOT_DIR` to get commits-behind count. Returns `{ behind: number, remoteVersion: string | null }`. Cache the fetch for the session (don't fetch twice).

2. **Modify `check-version` in `lib/commands/setup.js`** — before comparing local CLI vs project version, call `getAigonRemoteVersion()`. If behind > 0, print advisory message with the `--pull` flag suggestion.

3. **Add `--pull` flag to `update` command** — when present, runs `git pull origin main && npm install` in `ROOT_DIR` before proceeding with project sync. Re-reads `getAigonVersion()` after pull since `package.json` may have changed.

4. **Terminology in output messages**:
   - "CLI upgrade" for pulling aigon source
   - "Project sync" for updating target repo files
   - Example: `🔄 CLI upgrade: pulling latest aigon from origin...`
   - Example: `📦 Project sync: updating templates and agent configs...`

## Dependencies

- Requires aigon source to be a git repo with an `origin` remote (standard install path)
- `git fetch` must be available and have network access for remote check

## Out of Scope

- Auto-pulling without user opt-in (too risky for a development tool)
- Supporting non-git install methods (npm global install, etc.)
- Updating aigon across multiple machines

## Open Questions

- Should `--pull` also run `npm version patch` after pulling, or leave versioning to the maintainer?
- Should we add a `--self-update` alias that's more discoverable than `--pull`?

## Related

- `lib/commands/setup.js` lines 955-971 (`check-version`) and 973-1158 (`update`)
- `lib/utils.js` line 1354 (`getAigonVersion()`) and line 207 in config.js (`ROOT_DIR`)
- Getting started docs: `site/content/getting-started.mdx` § "Updating Aigon"
