# Deployment

## Overview

`aigon.dev` is a zero-build static site (plain HTML + CSS) hosted on **Cloudflare Pages**, auto-deployed via a direct GitHub integration. No CI/CD pipeline, no build step, no Node toolchain — a push to `main` is all it takes.

---

## Infrastructure

| Layer | Service | Notes |
|-------|---------|-------|
| Source control | GitHub — `github.com/jayvee/aigon-site` | |
| Hosting | Cloudflare Pages | Free tier; global CDN |
| DNS + SSL | Cloudflare | Domain managed in Cloudflare; SSL auto-provisioned |
| Custom domain | `aigon.dev` | Configured in Cloudflare Pages dashboard |
| Build tooling | None | Files served as-is |

---

## Deploy Pipeline: GitHub → Cloudflare Pages

Cloudflare Pages connects directly to the GitHub repository via OAuth — no GitHub Actions workflow is involved.

```
git push origin main
        │
        ▼
  GitHub receives push
        │
        │  Cloudflare Pages webhook (registered on repo)
        ▼
  Cloudflare Pages detects new commit on `main`
        │
        ▼
  Build step runs (framework: None / static output)
  — No build command
  — Root directory served as-is
        │
        ▼
  Files deployed to Cloudflare's global edge network
        │
        ▼
  https://aigon.dev live within ~30 seconds
```

### What triggers a deploy

- Any push to the `main` branch triggers a production deployment.
- Pull request branches automatically get a preview URL at `<hash>.aigon-site.pages.dev`.

### What Cloudflare Pages does

1. Clones the repo at the new commit SHA.
2. Runs no build command (framework set to "None").
3. Serves the repository root as the static output directory.
4. Invalidates the CDN edge cache and propagates the new files globally.

---

## Repository Structure

```
project-root/
├── index.html          # Entry point — served at /
├── css/
│   └── style.css       # All styles
├── img/                # Static images
├── favicon.ico
├── _headers            # Cloudflare Pages cache rules
├── .gitignore
├── CLAUDE.md
├── PRODUCT.md
└── docs/               # Aigon specs + this file
```

No `package.json`, no `node_modules`, no bundler config. Cloudflare Pages needs none of it.

---

## Custom Domain and HTTPS

- Domain `aigon.dev` is registered and DNS is managed in Cloudflare.
- The domain is added under **Pages → aigon-site → Custom domains**.
- Because DNS is on Cloudflare, propagation is instant (no external nameserver delay).
- SSL certificate is provisioned automatically by Cloudflare (Universal SSL). HTTPS is enforced.
- The `.pages.dev` subdomain (`aigon-site-<hash>.pages.dev`) remains active as a secondary alias.

---

## Local Development

No server required — open `index.html` directly in a browser:

```bash
open index.html
```

Or use any static file server locally:

```bash
python3 -m http.server 8080
```

No environment variables, secrets, or service connections are needed for local work.

---

## Monitoring Deployments

### Cloudflare Dashboard (primary)
1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **Pages** → `aigon-site`.
2. The **Deployments** tab shows each deploy with status, commit SHA, branch, timestamp, and build logs.
3. Build logs are available in real time during a deploy.

### Wrangler CLI
Authenticate once, then use from the terminal:

```bash
wrangler login
wrangler pages deployment list --project-name aigon-site
wrangler pages deployment list --project-name aigon-site --environment production
```

---

## Rollback

Any previous deployment can be promoted to production instantly from the Cloudflare Pages dashboard without a new commit:

1. **Deployments** tab → find the target deployment.
2. Click **...** → **Rollback to this deployment**.
3. Cloudflare re-routes traffic to the selected build. Takes seconds.

---

## Branch and Preview Deployments

| Branch | Deployment type | URL |
|--------|----------------|-----|
| `main` | Production | `https://aigon.dev` |
| Any other branch | Preview | `https://<branch-name>.aigon-site.pages.dev` |

Preview URLs are automatically created for feature branches pushed to GitHub. They are isolated and do not affect production.

---

## Caching

### How Cloudflare Pages caches by default

Cloudflare Pages sets the following response headers automatically:

| File type | Default `Cache-Control` | Edge cache |
|-----------|------------------------|------------|
| `*.html` | `public, max-age=0, must-revalidate` | Not cached at edge |
| `css/style.css`, `favicon.ico`, etc. | `public, max-age=0, must-revalidate` | Not cached at edge |
| Files in subdirectories | Same | Same |

On every deployment Cloudflare purges the edge cache automatically, so CDN caching is never the cause of stale content. **The main caching risk is the browser.**

### Browser caching and the `_headers` file

This project serves `css/style.css` with no content hash in the filename. The `_headers` file overrides cache behaviour to prevent stale CSS:

```
/css/*
  Cache-Control: public, max-age=0, must-revalidate

/*.html
  Cache-Control: public, max-age=0, must-revalidate

/img/*
  Cache-Control: public, max-age=31536000, immutable

/favicon.ico
  Cache-Control: public, max-age=86400
```

**Short-term fix for stale cache:** Hard refresh — `Cmd+Shift+R` (Mac) / `Ctrl+Shift+R` (Windows).

---

## Key Constraints

- **No build command.** Any file that should not be served publicly must be excluded via Cloudflare Pages' ignore settings or the repo structure itself.
- **No server-side logic.** This is a pure static site. Forms, APIs, and dynamic features would require Cloudflare Workers or an external service.
- **Google Fonts loaded via `<link>`.** The only external runtime dependency. No CDN fallback is configured.
