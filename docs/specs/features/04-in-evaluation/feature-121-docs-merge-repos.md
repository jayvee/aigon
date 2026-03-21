# Feature: docs-merge-repos

## Summary

Merge the `aigon-site` repo (`~/src/aigon-site`) into the main `aigon` repo under `site/`. Configure Vercel to deploy from the `site/` subdirectory. Verify the existing static site deploys correctly from the new location before any framework changes. This is the prerequisite for all docs work — it eliminates the repo handoff problem.

## Acceptance Criteria

- [ ] `aigon-site` content lives at `aigon/site/` (HTML, CSS, assets, scripts)
- [ ] Git history from aigon-site is preserved (use `git subtree add` or `filter-repo`)
- [ ] Vercel project configured with root directory = `site/`
- [ ] Existing static site deploys successfully to Vercel from `site/`
- [ ] `aigon-site` repo archived (README points to `aigon/site/`)
- [ ] `site/` has its own `package.json` (even if empty for now) for future Next.js deps
- [ ] `.gitignore` updated for `site/node_modules/`, `site/.next/` etc.
- [ ] Dashboard (`aigon dashboard`) still works — no conflicts with site dev server

## Validation

```bash
node -c aigon-cli.js
ls site/index.html  # static site exists in new location
```

## Technical Approach

1. `git subtree add --prefix=site ~/src/aigon-site main` to bring in history
2. Move any loose files into proper structure under `site/`
3. Create Vercel project (or update existing) with root directory = `site/`
4. Deploy and verify aigon.build still works
5. Archive `aigon-site` repo on GitHub

## Dependencies

- None

## Out of Scope

- Framework changes (that's docs-site-build)
- Content restructuring
- DNS changes (still on Cloudflare Pages until docs-go-live)

## Related

- Research: #17 new-docs-site
- Feature: docs-site-build (builds on this)
