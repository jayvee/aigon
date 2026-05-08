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

4. **Publish to npm:**
   ```bash
   node scripts/publish.js
   ```
   The publish script reads the version and automatically publishes to `next` for prerelease versions, `latest` for stable versions.
   Requires an npm auth token in `~/.npmrc` — see **npm authentication** below.

## Stable launch (when ready)

1. Bump version to a clean semver (e.g. `2.64.0` — no `-beta.N` suffix).
2. Update CHANGELOG with a proper release date.
3. Commit, tag `v2.64.0`, push + push tags.
4. `npm run release` — lands on `latest`.
5. Deprecate any beta versions that were published to `latest` by mistake:
   ```bash
   npm deprecate @senlabsai/aigon@<version> "Use the stable release: npm i -g @senlabsai/aigon"
   ```
6. Update `site/content/getting-started.mdx` and `README.md` — remove the `@next` suffix from install commands.

## npm authentication

Classic tokens were permanently revoked December 2025. Use a **Granular Access Token** instead.

### One-time setup

1. Go to **npmjs.com → your avatar → Access Tokens → Generate New Token → Granular Access Token**
2. Fill in:
   - **Token name:** `aigon-publish` (or anything)
   - **Expiration:** 90 days (maximum)
   - **Packages and scopes → Permissions:** Read and write
   - **Packages and scopes → Scope:** `@senlabsai`
   - **Bypass two-factor authentication:** ✅ checked ← critical, defaults to unchecked
3. Generate and copy the token
4. Add to `~/.npmrc`:
   ```
   //registry.npmjs.org/:_authToken=<your-token>
   ```

After this, `node scripts/publish.js` works with no prompts. Rotate the token every 90 days.

### Quick session publish (no token setup)

```bash
npm login   # opens browser → passkey auth → 2-hour session
node scripts/publish.js
```

Works for one-off publishes without storing a token. Session expires after 2 hours.

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
