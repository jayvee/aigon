# Feature: delete deprecated command doc pages

## Summary
The docs site contains two `(removed)` deprecation pages — `feature-submit.mdx` and `feature-autopilot.mdx` — that exist as a courtesy for old SEO links. The user count is small enough that this courtesy isn't worth the maintenance cost or the visual clutter in the CLI reference sidebar. Delete both pages and remove `feature-submit` from the nav menu. Anyone hitting the old URLs will get a 404, which is honest.

## User Stories

- [ ] As a maintainer, I want fewer dead pages in the docs sidebar so the reference index reflects only commands that actually exist
- [ ] As a new user browsing the CLI reference, I shouldn't see `(removed)` entries — they look like clutter and suggest the project is still in flux

## Acceptance Criteria

- [ ] **AC1** — `site/content/reference/commands/feature/feature-submit.mdx` is deleted
- [ ] **AC2** — `site/content/reference/commands/feature/feature-autopilot.mdx` is deleted
- [ ] **AC3** — `site/content/reference/commands/feature/_meta.js` no longer mentions `feature-submit`
- [ ] **AC4** — Grep for any other references to these removed commands in the docs site, internal docs, or root docs and remove or update them as needed
- [ ] **AC5** — `npm run --prefix site build` succeeds
- [ ] **AC6** — Manual check: visit `/docs/reference/commands/feature/feature-submit` and `/feature-autopilot` — both should return 404 (Vercel will handle this naturally for missing MDX paths)

## Validation
```bash
cd site && npm run build && cd ..
test ! -f site/content/reference/commands/feature/feature-submit.mdx
test ! -f site/content/reference/commands/feature/feature-autopilot.mdx
! grep -q "feature-submit" site/content/reference/commands/feature/_meta.js
```

## Technical Approach

1. **Delete the two MDX files:**
   ```bash
   git rm site/content/reference/commands/feature/feature-submit.mdx
   git rm site/content/reference/commands/feature/feature-autopilot.mdx
   ```

2. **Update `_meta.js`** to remove the `feature-submit` line:
   ```js
   // Remove this line from site/content/reference/commands/feature/_meta.js:
   "feature-submit": "feature-submit",
   ```
   Note: `feature-autopilot` was already orphaned from `_meta.js` (one of the inconsistencies that triggered this feature).

3. **Grep for stale references:**
   ```bash
   grep -rln "feature-submit\|feature-autopilot" site/content/ docs/ README.md
   ```
   Update any remaining mentions to point at the modern equivalents:
   - `feature-submit` → use `feature-do` (the shell trap auto-signals submission), or call `aigon agent-status submitted` manually
   - `feature-autopilot` → use `feature-autonomous-start`

4. **Single commit** with a clear message:
   ```
   docs(site): remove deprecation pages for feature-submit and feature-autopilot

   The user count for Aigon is small enough that maintaining courtesy
   redirect pages for renamed commands isn't worth the sidebar clutter.
   Old URLs will 404 — anyone landing there can use the docs search.
   ```

## Dependencies
- None — pure docs deletion

## Out of Scope

- Setting up Vercel/Next.js redirects from old URLs to new ones (the user count doesn't justify the config complexity)
- Removing the deprecation pages from the upstream `templates/` directory (they don't exist there — the .mdx files only live in `site/content/`)
- Removing `feature-cleanup`, `feature-reset`, `feature-validate` from the nav — these are real commands still in `lib/commands/` and have accurate docs (NOT in scope for this feature)
- Removing `feature-submit` / `feature-autopilot` from any historical spec files in `docs/specs/features/05-done/` or `docs/specs/features/logs/` — those are historical records and stay

## Open Questions

- Should we add a `vercel.json` redirect from `/docs/reference/commands/feature/feature-submit` → `/docs/reference/commands/feature/feature-do`? Recommendation: **no**, per the user's stated preference not to maintain courtesy infrastructure for the small user base. 404 is fine.

## Related

- Discovered during the 2026-04-07 site audit before launch
- Originally framed as "make the deprecated pages consistent in nav" — user changed the requirement to "delete them entirely" (small user base, not worth the maintenance)
- `feature-232` (already shipped) — the original purge of AADE wording that left these deprecation pages behind
