# Releasing Aigon

## Release channels

| Channel | npm dist-tag | Version format | Who installs it |
|---------|-------------|----------------|-----------------|
| Beta (current) | `next` | `2.x.y-beta.N` | Anyone using `@next` |
| Stable (future) | `latest` | `2.x.y` | Anyone using the default install |

During the beta period, all normal releases go to `next`. Only a deliberate stable launch bumps `latest`.

## Normal beta release (most releases)

1. **Bump version** in `package.json` — increment the beta counter or minor version:
   ```
   2.64.0-beta.1 → 2.64.0-beta.2   (patch-level changes)
   2.64.0-beta.2 → 2.65.0-beta.1   (significant new features)
   ```

2. **Update CHANGELOG.md** — move unreleased items into a new `[2.x.y-beta.N]` section.

3. **Commit and tag:**
   ```bash
   git add package.json CHANGELOG.md
   git commit -m "chore: bump version to 2.x.y-beta.N"
   git tag v2.x.y-beta.N
   git push && git push origin v2.x.y-beta.N
   ```

4. **Publish to npm** (prompts for OTP — always use `npm run release`, never bare `npm publish`):
   ```bash
   npm run release
   ```
   The `release` script reads the version and automatically publishes to `next` for prerelease versions, `latest` for stable versions.

## Stable launch (when ready)

1. Bump version to a clean semver (e.g. `2.64.0` — no `-beta.N` suffix).
2. Update CHANGELOG with a proper release date.
3. Commit, tag `v2.64.0`, push + push tags.
4. `npm run release` — lands on `latest`.
5. Deprecate any beta versions that were published to `latest` by mistake:
   ```bash
   npm deprecate @senlabs/aigon@<version> "Use the stable release: npm i -g @senlabs/aigon" --otp=<code>
   ```
6. Update `site/content/getting-started.mdx` and `README.md` — remove the `@next` suffix from install commands.

## OTP note

npm 2FA prompts come in two forms:
- **Browser auth flow** — works for `npm publish` but fails for `npm deprecate`. If you see a 404 error on the auth endpoint, add `--otp=<code>` directly:
  ```bash
  npm deprecate @senlabs/aigon@<version> "message" --otp=<code>
  npm publish --tag <tag> --otp=<code>
  ```
- **TOTP code** — get from your authenticator app and append as `--otp=<6-digit-code>`.

## What `npm run release` does

`scripts/publish.js` reads the version from `package.json`, asserts that stable versions go to `latest` and prerelease versions go to `next`, then runs `npm publish --tag <channel>`. It will fail loudly if the version and channel are inconsistent (e.g. a clean version number accidentally tagged `next`).

## Git tags

Every published version should have a matching git tag (`v2.x.y` or `v2.x.y-beta.N`) pushed to origin. Tags are used by GitHub releases and by `aigon --version` to resolve the release context.

```bash
git tag v2.x.y <commit-sha>   # tag a specific commit
git push origin v2.x.y         # push the tag
```

## Files checklist

| File | Update on beta release | Update on stable launch |
|------|----------------------|------------------------|
| `package.json` version | ✅ | ✅ |
| `CHANGELOG.md` | ✅ | ✅ |
| `README.md` install command | — | Change `@next` → no tag |
| `site/content/getting-started.mdx` | — | Change `@next` → no tag, remove beta callout |
