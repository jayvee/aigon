---
complexity: medium
set: dash-arch
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-07T06:05:20.172Z", actor: "cli/feature-prioritise" }
---

# Feature: dash-arch-9-css-architecture

## Summary

Restructure the dashboard's single 173KB `templates/dashboard/styles.css` (1,685 lines — heavily multi-rule lines, effectively unreviewable diffs) into a set of per-concern stylesheet files with a clear layering: tokens/reset → layout/shell → shared components (buttons, pills, badges, modals, toasts) → per-view sheets (monitor cards, kanban, drawer, terminal panel, settings, reports/stats, logs, sessions). Serve them either as multiple `<link>` tags or via a trivial server-side concat in the existing `/styles.css` route — **no build step**. Include a dead-rule audit: the file has accreted through ~600 features and demonstrably carries selectors for removed markup (e.g. legacy Pro tab views). Smaller, named files make the mandatory `Skill(frontend-design)` passes and CSS review actually possible, and reduce merge conflicts between parallel dashboard features.

## User Stories

- [ ] As a maintainer changing kanban card styles, I open `styles/kanban.css` and see only kanban rules — not one line in a 173KB file my editor struggles to diff.
- [ ] As a reviewer, a feature's CSS diff touches only the sheet(s) for the views it changed, so unrelated-style regressions stand out.
- [ ] As two agents implementing dashboard features in parallel worktrees, our CSS changes don't collide in a single-file merge.
- [ ] As a user, the dashboard looks pixel-identical before and after — this is a pure restructuring.

## Acceptance Criteria

- [ ] `templates/dashboard/styles/` contains the split sheets; a deliberate order manifest exists (either the `<link>` order in index.html or an ordered list the server concat uses). Recommended split: `tokens.css` (custom properties, theming), `base.css` (reset, typography, `.wrap`/shell), `components.css` (btn, pill, badge, toast, modal, tooltip primitives), then one sheet per view/surface: `monitor.css`, `kanban.css`, `drawer.css`, `terminal.css`, `settings.css`, `stats.css`, `logs.css`, `sessions.css`, `notifications.css`, `budget.css`. Adjust to the natural seams found — the *named-seams* requirement is the criterion, not this exact list.
- [ ] Delivery decision implemented one way, documented in the feature log: (a) multiple `<link rel="stylesheet">` tags (simplest; fine over localhost), or (b) the dashboard server's `/styles.css` route concatenates the ordered sheets at serve time with the same cache headers as today (preferred if any measurable FOUC appears with option a). Preview servers (`aigon preview`) must serve identically; if option (a) is chosen, the static handler must serve `/styles/*.css` with `text/css`.
- [ ] Cascade safety: rule order within and across files preserves today's computed styles. Verification is mechanical, not eyeball: dump computed styles for a representative element set (or diff the concatenated output against the original file after a pure reorder-free split) — document the method used.
- [ ] Dead-rule audit: selectors with no matching markup in `index.html` + all `js/**` string templates + stub files are removed, each removal listed in the feature log with the grep evidence. When in doubt (dynamically-composed class names like `'status-' + x`, `agent-` prefixes, `kcard-` variants), KEEP the rule — false-positive deletion is the failure mode that matters (verify-before-claiming-broken applies to CSS too).
- [ ] Custom properties consolidated in `tokens.css`: any hardcoded values that obviously duplicate an existing token (`--text-secondary`, `--bg-surface`, `--mono`, etc.) in *moved* rules may be tokenised, but no visual retunes — `Skill(frontend-design)` invoked before any judgement call, per hot rule #7.
- [ ] Inline `style="..."` attributes in index.html and JS templates are NOT migrated in this feature (scope control) — but a count is recorded in the feature log as follow-up input.
- [ ] Full Playwright e2e green; MCP `browser_snapshot` on monitor, pipeline, settings, reports, spec drawer, terminal panel; before/after screenshots of each to `./tmp/` (never repo root). If the repo has visual-diff tooling in `tests/dashboard-e2e`, use it; otherwise side-by-side screenshots suffice.
- [ ] `npm run test:deploy` includes any styles path checks (verify `scripts/check-test-budget.sh`, package pack checks, and template-leak checker are unaffected by the new file layout).

## Validation

```bash
npm run test:iterate
```

## Technical Approach

- Split mechanically first (cut lines, preserve order, zero edits), verify identical concat output byte-for-byte (modulo file boundaries), THEN do the dead-rule audit as separate commits — never mix moving and deleting in one commit.
- The 1,685-line/173KB ratio means many rules share lines; run a non-destructive formatter pass (one rule per line) as its own commit *before* splitting so future diffs are line-accurate. Confirm the formatter changes nothing semantically (identical minified output).
- Check `buildDashboardHtml` / static file serving in `lib/dashboard-server.js` for how `/styles.css` is served and whether templates are processed (`{{...}}` placeholders) — the split sheets must go through the same path.
- Theme/dark-mode: note how theming works today (tokens at `:root`?) and keep all theme-sensitive rules in/near `tokens.css`.
- Coordinate lightly with dash-arch-4/7 (they touch index.html's head/body); land after them if running the set in order, but there is no hard dependency.

## Dependencies

- None hard. Sequencing note: least merge pain if landed after dash-arch-4 and dash-arch-7.

## Out of Scope

- Any visual redesign, spacing/color retunes, or new components.
- Migrating inline `style=""` attributes to classes (counted, not done).
- CSS minification, PostCSS, preprocessors, `@layer` adoption (revisit once browser floor is confirmed; not needed for correctness here).
- The docs site styles.

## Open Questions

- Is there any per-instance or template placeholder substitution inside styles.css today? (Grep for `${` / `{{` before assuming it's static.)
- HTTP/1.1 localhost with ~14 stylesheet requests is fine, but the dev proxy path should be sanity-checked — if it adds per-request latency, prefer the server-concat option.

## Related

- Prior work: hot rule #7 (`Skill(frontend-design)` mandatory), `docs/card-design-wireframe.html` (canonical card reference — unchanged), F556-era lint hygiene as the JS analogue of this cleanup.
- Set: dash-arch — wave 3 (assets: 8, 9).
