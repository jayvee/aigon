<!-- description: Ship the current branch — share to origin / cut a tagged version / publish to npm -->
# aigon-ship

Drive the release flow with three discrete modes. Always go through this command instead of stitching `git push` / `npm publish` calls by hand — the script enforces the pre-push gate, refuses to ship a dirty tree, validates the version against `CHANGELOG.md`, and routes the npm dist-tag automatically.

> The script is **`scripts/ship.js`**, exposed via `npm run ship -- <mode> [flags]`. Slash command, npm script, and direct node invocation all hit the same code path.

## Modes

### 1. share — push the current branch to origin

Use when you want to back up work or share with collaborators without cutting a release. **No version bump, no tag, no npm.**

```bash
npm run ship -- share
```

What runs:
1. Sanity checks (clean tree, branch not behind upstream).
2. `npm run test:deploy` (test:core + test:browser + budget check).
3. `git push origin <current-branch>`.

### 2. cut — bump version, tag, and push (no npm)

Use when you want a tagged GitHub release without publishing to the registry. Useful for shipping internal milestones or before a final Docker test pass.

```bash
npm run ship -- cut --version=2.64.0-beta.5
```

What runs:
1. Everything `share` does.
2. Asserts `CHANGELOG.md` already has a `## [2.64.0-beta.5]` heading (write the entry first; the script never auto-generates).
3. Bumps `package.json` to the new version + commits as `chore(release): <version>`.
4. Tags `v<version>` on the new commit.
5. `git push origin <branch>` then `git push origin --tags`.

### 3. publish — cut + npm publish

Use when you're ready for the npm registry. Anything with a `-suffix` (e.g. `2.64.0-beta.5`) ships to the `next` dist-tag; bare semver (e.g. `2.65.0`) ships to `latest`.

```bash
npm run ship -- publish --version=2.65.0
```

What runs:
1. Everything `cut` does.
2. Asserts `npm whoami` succeeds (so the publish doesn't fail after a long test run).
3. `npm run release` (which runs `prepublishOnly` → `scripts/check-pack.js` → `npm publish --tag <next|latest>`).

## Flags

| Flag | Effect |
|------|--------|
| `--version=<x.y.z[-tag]>` | Required for `cut` and `publish`. |
| `--skip-tests` | Skip the `test:deploy` gate. Use only when the gate is broken for unrelated reasons; document why. |
| `--allow-dirty` | Allow uncommitted files in the working tree. Off by default — release-time leaks are usually unintended (`.env.local`, scratch artefacts). |
| `--dry-run` | Print the action plan and exit. |
| `--yes` | Skip the confirmation prompt before destructive steps. |

## Common workflows

- **Just back up your work** — `npm run ship -- share`
- **Cut a beta release for internal testing** — write the changelog entry, then `npm run ship -- cut --version=2.64.0-beta.5`
- **First npm publish ever** — make sure the `@senlabsai` org exists on npm and you've run `npm login`, then `npm run ship -- publish --version=2.64.0-beta.4`
- **See what would happen without doing anything** — append `--dry-run` to any of the above

## Pre-flight checklist before `cut` / `publish`

1. `git status` is clean (or pass `--allow-dirty` and know what you're doing).
2. The `## [<version>]` section in `CHANGELOG.md` is filled in. The script blocks if it isn't.
3. `npm run test:deploy` passes locally (the script runs it for you, but a cold first run takes ~2 minutes — start it early if you're impatient).
4. For `publish`: `npm whoami` works; the `@senlabsai` org exists on npmjs.com.
