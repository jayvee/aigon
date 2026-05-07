---
complexity: low
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-07T05:00:33.668Z", actor: "cli/feature-prioritise" }
---

# Feature: rename-senlabs-to-senlabsai

## Summary

Rename the npm package from `@senlabs/aigon` to `@senlabsai/aigon` across all source files, docs, templates, tests, and site content. This is a mechanical find-and-replace sweep with no behavioural changes. Also update the getting-started.mdx Pro install section (which still references the old GitHub private-repo clone flow) to use the new `npm install -g @senlabsai/aigon-pro` + `aigon pro activate <key>` instructions.

## User Stories

- [ ] As a new user following the docs, every install command I see says `@senlabsai/aigon`
- [ ] As an existing user, `npm update -g @senlabsai/aigon@next` works after the package is republished under the new org

## Acceptance Criteria

- [ ] `grep -r "@senlabs/aigon" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=docs/specs` returns zero results
- [ ] `package.json` `"name"` is `"@senlabsai/aigon"`
- [ ] `site/content/getting-started.mdx` install commands use `@senlabsai/aigon@next` and the Pro section shows the new 3-step flow (install package, activate key, restart server) — not the old git clone flow
- [ ] `npm test` passes
- [ ] `node -c aigon-cli.js` passes

## Validation

```bash
node -c aigon-cli.js
npm test
grep -r "@senlabs/aigon" . --include="*.js" --include="*.json" --include="*.md" --include="*.mdx" --include="*.tsx" --include="*.yml" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=docs/specs
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.
- May run `npm install` to regenerate `package-lock.json` after updating `package.json` name field.

## Technical Approach

Grep first, then replace file by file:

```bash
grep -r "@senlabs/aigon" . --include="*.js" --include="*.json" --include="*.md" --include="*.mdx" --include="*.tsx" --include="*.ts" --include="*.yml" --exclude-dir=node_modules --exclude-dir=.git -l
```

Key files: `package.json`, `README.md`, `RELEASING.md`, `AGENTS.md`, `lib/npm-update-check.js`, `scripts/publish.js`, `lib/commands/setup.js`, `lib/commands/infra.js`, `lib/commands/misc.js`, `lib/onboarding/wizard.js`, `site/content/getting-started.mdx`, `site/content/guides/insights.mdx`, `site/content/reference/commands/setup/update.mdx`, `site/app/pro/page.tsx`, `templates/dashboard/js/settings.js`, integration tests.

After updating `package.json`, run `npm install` to regenerate `package-lock.json`.

## Dependencies

- None (can run in parallel with F485)

## Out of Scope

- `senlabs.ai` domain links (e.g. in `site/app/layout.tsx`) — that is the company website domain, not the npm org; leave unchanged
- `docs/specs/features/05-done/` and `logs/` — historical record, leave untouched
- `.aigon/cache/` files — ephemeral, ignore
