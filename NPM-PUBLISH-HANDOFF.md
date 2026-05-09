# npm Publish Handoff

## What we are trying to do

Publish two packages to npm under the `@senlabsai` org for the first time:

1. **`@senlabsai/aigon`** — the open-source CLI, version `2.64.0-beta.4`, to the `@next` tag
2. **`@senlabsai/aigon-pro`** — the commercial Pro package, version `0.1.0`, to the `@beta` tag

Both packages are fully built and ready. The only blocker is npm authentication.

---

## What is done

- Both packages are built and packed (tarballs verified working)
- `@senlabsai` org created on npmjs.com, owner is npm user `senlabs`
- `RELEASING.md` documents the full release process
- `scripts/publish.js` handles aigon publish (auto-selects `@next` for beta versions)
- aigon-pro uses `npm publish --tag beta`

---

## Where we are blocked

npm requires 2FA for publish. The account uses **passkey** 2FA (not TOTP), so there is no OTP code available. Classic tokens were permanently revoked by npm in December 2025. The solution is a **Granular Access Token** with "Bypass two-factor authentication" checked.

---

## What needs to be done

### Step 1 — Create npm publish token (one-time)

1. Go to **npmjs.com** → log in as `senlabs`
2. Avatar → **Access Tokens** → **Generate New Token** → **Granular Access Token**
3. Fill in:
   - Token name: `aigon-publish`
   - Expiration: 90 days
   - Packages and scopes → Permissions: **Read and write**
   - Packages and scopes → Scope: **`@senlabsai`**
   - **Bypass two-factor authentication: ✅ CHECK THIS BOX** (defaults unchecked)
4. Generate and copy the token
5. Add to `~/.npmrc` on the Mac:
   ```
   //registry.npmjs.org/:_authToken=<token>
   ```

### Step 2 — Publish aigon OSS

```bash
cd ~/src/aigon
node scripts/publish.js
```

Expected: publishes `@senlabsai/aigon@2.64.0-beta.4` to the `@next` tag.

### Step 3 — Publish aigon-pro

```bash
cd ~/src/aigon-pro
npm publish --tag beta
```

Expected: publishes `@senlabsai/aigon-pro@0.1.0` to the `@beta` tag.

### Step 4 — Verify both published

```bash
npm view @senlabsai/aigon@next version
npm view @senlabsai/aigon-pro@beta version
```

---

## Repo locations

| Repo | Path | GitHub |
|------|------|--------|
| aigon (OSS) | `~/src/aigon` | github.com/jayvee/aigon |
| aigon-pro | `~/src/aigon-pro` | private |

## Key files

| File | Purpose |
|------|---------|
| `~/src/aigon/RELEASING.md` | Full release process documentation |
| `~/src/aigon/scripts/publish.js` | Publish script for aigon OSS |
| `~/src/aigon-pro/package.json` | aigon-pro package config (`publishConfig` points to registry.npmjs.org, access public) |

---

## Notes

- The `@next` and `@beta` tags mean neither package is installed by default (`npm install @senlabsai/aigon` returns 404 until promoted to `latest`)
- Promote to latest when ready: `npm dist-tag add @senlabsai/aigon@2.64.0-beta.4 latest`
- aigon-pro is obfuscated (esbuild minification) and key-gated — even if publicly discoverable, it won't activate without the beta key
