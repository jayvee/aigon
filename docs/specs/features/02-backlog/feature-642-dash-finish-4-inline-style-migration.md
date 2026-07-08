---
complexity: medium
set: dash-finish
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-08T00:14:51.845Z", actor: "cli/feature-prioritise" }
---

# Feature: dash-finish-4-inline-style-migration

## Summary
F628 (dash-arch-9) split the CSS monolith into ordered `templates/dashboard/styles/` sheets but explicitly deferred the inline-style problem: ~220 `style="…"` occurrences remain across `index.html` (~89) and JS-built markup (~197 including stubs). Inline styles bypass the stylesheet architecture — they can't be themed, they defeat the cascade, they hide layout decisions inside template literals, and `element.style.display` toggles fight the view registry's visibility contract. This feature migrates them to classes in the appropriate `styles/` sheet, leaving only the truly dynamic ones (computed widths/heights, chart dimensions) as documented exceptions.

## User Stories
- [ ] As a maintainer restyling a dashboard component, I find all of its styling in its `styles/` sheet — not scattered across `style="…"` attributes in three JS files.
- [ ] As a maintainer, show/hide state is expressed with a class or the existing `data-hidden` convention, consistent with how the view registry and Alpine manage visibility.

## Acceptance Criteria
- [ ] `rg -c 'style="' templates/dashboard/index.html templates/dashboard/js templates/dashboard/stubs` drops from ~220 to a small documented allowlist (target: <25), where every survivor is genuinely dynamic (values computed at runtime — e.g. progress-bar %, sidebar resize width, chart canvas sizing) and carries no static declarations.
- [ ] Static show/hide (`style="display:none"`) converts to the existing `data-hidden` attribute convention or a utility class — one convention, applied consistently; JS `el.style.display = …` toggles on those elements convert with them.
- [ ] New classes land in the correct existing sheet per concern (`kanban.css`, `drawer.css`, `settings.css`, …); if a new sheet is warranted it is added to `styles/manifest.json` (unlisted files are not served).
- [ ] Zero intended visual change: before/after MCP `browser_snapshot` of every view (Monitor, Pipeline, Sessions, Reports, Insights, Logs, All Items, Settings) plus the spec drawer and notifications panel, compared and attached to the implementation log.
- [ ] `npm run test:browser` passes.

## Validation
```bash
```

## Technical Approach
Inventory → classify → migrate per view, one commit per view for reviewability. `Skill(frontend-design)` before starting (mandatory for CSS work). Prefer reusing existing utility patterns already in the sheets over inventing near-duplicate classes; check `docs/card-design-wireframe.html` before touching anything on pipeline cards. The stubs (`templates/dashboard/stubs/`) are served to OSS users in place of Pro modules — migrate their inline styles too, but do not change their exported function signatures.

## Dependencies
-

## Out of Scope
- Any intentional visual/design change — this is a pure refactor.
- Dark-mode/theming work (this feature merely stops blocking it).
- The `style.display` usage inside `view-registry.js` chrome management (that is the registry's job; it stays).

## Open Questions
- Exact allowlist format for the surviving dynamic styles — a comment convention at each site vs a short list in the implementation log (pick one; no new sidecar files).

## Related
- Prior work: F628 (dash-arch-9-css-architecture) — its log records the 221-occurrence count and defers this migration.
