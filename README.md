# Aigon

A zero-dependency static marketing site for Aigon, hosted on Cloudflare Pages.

## What's included

- **Plain HTML + CSS** — no framework, no npm, no bundler
- **Complete landing page content** — hero, problem, features, lifecycle loop, workflow, docs, philosophy, and community sections
- **Animated SVG lifecycle loop** — Research → Features → Review → Feedback
- **Lightweight progressive enhancement** — section reveal animations + active nav state (vanilla JS)
- **Responsive layout** — optimized for desktop and mobile
- **Cloudflare Pages** deployment with `scripts/watch-deploy.sh` for live status polling
- **Aigon workflow** — spec-driven development with Claude Code, Cursor, Gemini, and Codex
- **Claude Code skills** — `/deploy-status` and `/deploy-logs` for deployment monitoring
- **Cache headers** via `_headers` for instant CSS/HTML refreshes on deploy

## Quick start

```bash
# 1. Clone the repo
git clone https://github.com/jayvee/aigon-site.git
cd aigon-site

# 2. Open locally
open index.html

# 3. Push and watch it deploy
git push origin main
bash scripts/watch-deploy.sh
```

## Cloudflare Pages setup

1. Create a new project at [dash.cloudflare.com](https://dash.cloudflare.com) → **Pages → Create a project → Connect to Git**
2. Project name: `aigon-site`
3. Framework preset: **None**, build command: blank, output directory: `/` (root)
4. Connect to GitHub repo: `jayvee/aigon-site`
5. Add custom domain `aigon.dev` under **Pages → aigon-site → Custom domains**
6. ✅ `CLOUDFLARE_API_TOKEN` already added to `.env.local`

## Deployment monitoring

After pushing to `main`:

```bash
bash scripts/watch-deploy.sh
```

Polls every 5 seconds until your commit SHA appears as the live production deployment.
Requires `wrangler` CLI and `CLOUDFLARE_API_TOKEN` in `.env.local`.

## Design notes

- Typography: `Sora`, `Manrope`, and `IBM Plex Mono`
- Visual style: warm editorial palette with accent highlights
- Motion: animated loop path + staggered section/card reveals
- Accessibility: skip link, semantic landmarks, reduced-motion support

## Aigon workflow

This template includes the [Aigon](https://github.com/jayvee/aigon) spec-driven development workflow.

```
/aigon:feature-create <name>      — create a feature spec
/aigon:feature-prioritise <name>  — assign ID, move to backlog
/aigon:feature-setup <ID>         — set up solo implementation
/aigon:feature-do <ID>            — begin implementation work
/aigon:feature-close <ID>         — merge and complete
```

See `docs/development_workflow.md` for the full workflow documentation.

## Local development

No server required:

```bash
open index.html
# or
python3 -m http.server 8080
```

## Next steps

- [ ] `favicon.ico` in the repo root (uncomment `<link rel="icon">` in `index.html`)
- [ ] Update `PRODUCT.md` with product direction
- [ ] Connect Cloudflare Pages to GitHub repo `jayvee/aigon-site`
- [x] ~~Add `CLOUDFLARE_API_TOKEN` to `.env.local`~~
