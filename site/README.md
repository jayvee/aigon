# Aigon Site

Static marketing site for [Aigon](https://github.com/jayvee/aigon), now living inside the main `aigon` monorepo at `site/`.

> **Note:** This directory was merged from the standalone [`aigon-site`](https://github.com/jayvee/aigon-site) repo (now archived). Git history was preserved via `git subtree add`.

## What's included

- **Plain HTML + CSS** — no framework, no npm, no bundler
- **Complete landing page content** — hero, problem, features, lifecycle loop, workflow, docs, philosophy, and community sections
- **Animated SVG lifecycle loop** — Research → Features → Review → Feedback
- **Lightweight progressive enhancement** — section reveal animations + active nav state (vanilla JS)
- **Responsive layout** — optimized for desktop and mobile
- **Cache headers** via `_headers` for instant CSS/HTML refreshes on deploy

## Local development

```bash
cd site
open index.html
# or
python3 -m http.server 8080
```

## Deployment

Vercel project configured with root directory = `site/`. Deploys on push to `main`.

## Design notes

- Typography: `Sora`, `Manrope`, and `IBM Plex Mono`
- Visual style: warm editorial palette with accent highlights
- Motion: animated loop path + staggered section/card reveals
- Accessibility: skip link, semantic landmarks, reduced-motion support
