# Developer Package Security

This repository uses npm with committed lockfiles. Use the locked package manager and avoid dependency changes that bypass review.

## Package Manager

- Use npm for this repo. The root and site packages pin the current package manager with `packageManager: "npm@11.14.1"`.
- Keep `package-lock.json` and `site/package-lock.json` committed.
- Use lockfile installs for normal setup and CI: `npm ci`.
- Do not use `npm install <package>@latest` unless the update is necessary and reviewed.

## Cooldown Policy

- Project `.npmrc` sets `min-release-age=3`.
- npm measures `min-release-age` in days, so this blocks package versions published in the last 72 hours during npm install/update resolution.
- This is stricter than the 24-hour minimum and is intended to reduce exposure to fast-moving npm supply-chain attacks.
- The cooldown does not make an existing lockfile safe by itself. Review lockfile diffs before merging dependency changes.
- Do not bypass the cooldown for convenience. If a security update must bypass it, document why in the pull request.

## Safe Dependency Changes

- Prefer small, lockfile-reviewed dependency updates.
- Inspect new dependency lifecycle scripts before merging. Pay special attention to `preinstall`, `install`, `postinstall`, and `prepare`.
- Be cautious with `git:`, `github:`, `http:`, `https:`, `file:`, `link:`, `workspace:`, and tarball dependencies.
- Never commit npm auth tokens in project `.npmrc`.
- Keep personal tokens in user-level config or a credential manager, and rotate them if a suspicious install ran.

## Local Checks

Run these checks without installing packages:

```bash
npm run security:package-config
npm run security:suspicious-deps
```

`security:package-config` checks the repo-level npm cooldown and package-manager pinning. `security:suspicious-deps` scans lockfiles for Mini Shai-Hulud package families and install-script flags.

## CI And Automation

- CI should use `npm ci`, not floating installs.
- Dependency bots should avoid auto-merging dependency updates less than 72 hours old.
- Security-update exceptions should be explicit and reviewed.
- If automated dependency updates are enabled, configure the bot cadence and merge policy so package versions get at least a 3-day cooldown where possible.

## If A Suspicious Install Ran

- Stop running installs and lifecycle scripts.
- Remove `node_modules` only after preserving evidence you need for investigation.
- Rotate npm tokens.
- Rotate GitHub tokens, sessions, and SSH keys if exposure is plausible.
- Rotate cloud credentials that were present in the environment during install.
- Inspect `.github/workflows` and recent commits for unexpected changes.
- If you maintain npm packages, inspect package publishing history for unauthorized releases.
- Reinstall only after the lockfile is clean and the cooldown policy is configured.
