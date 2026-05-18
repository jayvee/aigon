---
name: release
description: Release Aigon — push to origin, cut a version+tag, or publish to npm. Wraps scripts/ship.js with CHANGELOG draft + dry-run preview. Triggers when the user types "/release", "/push", "/ship", or says "ship a release", "publish a beta", "cut a version", "push to origin", "release X to npm".
---

# release

Three escalating actions, all wrapping `scripts/ship.js`. The mode is chosen by the user's intent — never escalate without asking.

```
git push                   share              cut                publish
  │                          │                  │                   │
  no gate            test:deploy        + version+tag        + npm publish
  no tag             + push branch      + CHANGELOG          (auto-routes
  no version                              entry              -beta→@next,
                                                             stable→@latest)
```

## Step 0 — Ask mode first (MANDATORY, no exceptions)

**Before doing anything else** — even before running git commands — use `AskUserQuestion` to ask which mode they want. Do not infer from phrasing. Do not skip this step.

```
Question: "What kind of release do you want?"
Options:
  - git push          — push commits to origin, no tests, no version bump
  - share             — run test:deploy then push (no version tag)
  - cut               — version + tag + CHANGELOG entry (no npm publish)
  - publish to npm    — full release: tests + version + tag + npm publish
```

Only proceed to the steps below once the user has selected a mode.

## share — `npm run ship -- share`

Runs `test:deploy`, pushes branch. No prompts beyond confirmation.

If the user just wants raw bytes off the laptop with no test gate (e.g. they committed scratch data), `git push origin <branch>` is correct — say so and run it. Don't escalate to `share` reflexively.

## cut and publish — same flow, different final command

### 1. Pre-flight checks

Run in parallel:

- `git status --short` — must be empty. If not, list files and stop.
- `git rev-list origin/main..HEAD --count` — must be > 0. Else "nothing to ship".
- `git rev-parse --abbrev-ref HEAD` — should be `main`. Else warn + confirm.

### 2. Choose version

Read current state:

- Current version: `node -p "require('./package.json').version"`
- Latest tag: `git describe --tags --abbrev=0`

If the user didn't pass `--version=X`, propose:

- Current is `-beta.N` and commits are mostly `fix:` / `test:` / `chore:` → suggest `-beta.<N+1>`
- Commits include `feat:` → suggest minor bump + `-beta.1` (e.g. `2.65.0-beta.2` → `2.66.0-beta.1`)
- User says "stable" / "promote to latest" → drop `-beta.*` suffix

Confirm version with user before continuing.

### 3. Draft the CHANGELOG entry

```bash
node scripts/changelog-entry.js <version>
```

Shows a Keep-a-Changelog block grouped by Conventional Commits prefix. Read it back to the user and ask:

- Accept as-is?
- Edit the one-sentence headline?
- Move items between sections?
- Drop the **Internal** section (test/chore/docs) for user-facing release?

Once approved, insert the block into `CHANGELOG.md` **immediately above** the `## [Unreleased]` heading (keep `## [Unreleased]` for next time). Use Edit, not Write — preserves the rest of the file.

Commit the CHANGELOG update with the message `chore(changelog): <version> entry`.

### 4. Dry-run first

```bash
npm run ship -- <mode> --version=<version> --dry-run
```

Show the output. Confirm with the user before the real run.

### 5. Real run

```bash
npm run ship -- <mode> --version=<version> --yes
```

`ship.js` handles: re-running test:deploy, bumping `package.json`, the `vX.Y.Z` tag, push, and (for `publish`) `npm run release` which auto-routes the dist-tag.

**Dirty-tree gotcha — dashboard server regenerates `.aigon/install-manifest.json` + `.aigon/version`.** If the local dashboard is running it self-installs on every CLI invocation, re-dirtying the tree between dry-run and real run. Before publish: `node aigon-cli.js server stop`, then `git stash push -m release-prep -- .aigon/install-manifest.json .aigon/version`. Restart later with `aigon server restart`.

**npm 2FA — `EOTP` is expected and you cannot complete it.** npm publish on 2FA-enabled accounts prints a browser-approval URL that Claude Code redacts to `***` in tool output (the URL also can't be fished out of `~/.npm/_logs/*.log` — same redaction). If the user's `npm login` worked but `npm publish` returns `EOTP`, do **not** retry in-session and do **not** ask for an OTP code (browser-approval is not OTP-typed). Tell the user to run `npm publish --tag <next|latest>` in their own terminal so they can see and click the URL; surface the package version + dist-tag so they don't have to look it up. Resume from §6 once they confirm.

### 6. Post-publish housekeeping (publish only)

Templates may have changed during the bump — regenerate the manifest:

```bash
node aigon-cli.js install-agent --all
git add .aigon/install-manifest.json .claude/ .gemini/ .opencode/ .agents/ .codex/ .cursor/
git commit -m "chore: regenerate install-manifest post-publish"
git push origin main
```

## Rules

- **Never** pass `--allow-dirty` or `--skip-tests` unless the user explicitly says so. Uncommitted files in a release are usually a `.env.local` leak.
- **Never** retry `npm publish` on failure — surface the error verbatim. Most failures are auth/2FA; the user must handle them.
- **Never** publish a stable version (`2.X.Y`) without explicit user confirmation. `-beta.N` is the safe default for ongoing work.
- Channel routing is automatic via `scripts/publish.js`. Don't second-guess it.
- If `CHANGELOG.md` doesn't have `## [Unreleased]` — stop, ask the user where to insert.

## Errors

- `prepublishOnly` failure → it ran `check-template-leaks.js`, `check-install-manifest-clean.js`, or `check-pack.js`. Read the error, fix the root cause (don't bypass).
- `cut` fails on "CHANGELOG has no [vX.Y.Z] heading" → you forgot step 3 or the version mismatched.
- `npm publish 403` → not logged in or no publish rights. Surface verbatim.
- `npm publish EOTP` → 2FA browser-approval required. The auth URL is redacted in Claude Code output; hand off to the user's own terminal (see §5 note). Don't retry in-session.
- `npm publish E409` → version already exists. Bump.
