# Feature: split-dashboard-html-into-modules

## Summary
Split `templates/dashboard/index.html` (4,057 lines — 451 CSS, 300 HTML, 3,301 JS) into separate files so agents can work on one view without loading the entire dashboard. Currently the single file contains 11 logical JS sections (monitor, pipeline, settings, statistics, logs, terminal, spec drawer, sidebar, etc.), making it impossible to edit one feature without scrolling past 3,000 lines of unrelated code.

## User Stories
- [ ] As a developer, I want to edit the Statistics tab without loading the Pipeline code
- [ ] As a developer, I want to understand the dashboard structure from the file listing, not by reading a 4K-line file
- [ ] As a developer, I want CSS changes to not risk breaking JS and vice versa

## Acceptance Criteria
- [ ] CSS extracted to `templates/dashboard/styles.css` (~451 lines)
- [ ] JS extracted into separate files per logical section:
  - `templates/dashboard/js/state.js` — Alpine store, localStorage keys
  - `templates/dashboard/js/utils.js` — relTime, escHtml, showToast, copyText
  - `templates/dashboard/js/api.js` — all request*() fetch wrappers
  - `templates/dashboard/js/terminal.js` — terminal panel state + UI
  - `templates/dashboard/js/sidebar.js` — repo selection + sidebar render
  - `templates/dashboard/js/spec-drawer.js` — spec editor, Markdown preview, undo/redo
  - `templates/dashboard/js/monitor.js` — Monitor view Alpine component
  - `templates/dashboard/js/pipeline.js` — Pipeline/kanban view + drag state
  - `templates/dashboard/js/settings.js` — Settings view renderer
  - `templates/dashboard/js/statistics.js` — Stats, charts, sparklines
  - `templates/dashboard/js/logs.js` — Logs view with pagination
  - `templates/dashboard/js/init.js` — polling, event setup, init
- [ ] `index.html` reduced to ~300 lines (HTML structure + script/link tags)
- [ ] AIGON server serves JS/CSS files from `templates/dashboard/` (already serves assets)
- [ ] No functionality changes — all views work identically
- [ ] All existing Playwright dashboard tests pass
- [ ] README/GUIDE/dashboard.md updated to reference new file structure

## Validation
```bash
# Verify index.html is under 400 lines
test $(wc -l < templates/dashboard/index.html) -lt 400
# Verify JS files exist
ls templates/dashboard/js/state.js templates/dashboard/js/api.js templates/dashboard/js/monitor.js
ls templates/dashboard/styles.css
# Dashboard serves correctly
curl -s http://127.0.0.1:4100/ | grep -q 'styles.css' && echo "CSS linked"
```

## Technical Approach

### How the dashboard serves files
The AIGON server already serves static files from `templates/dashboard/assets/` for icons. Extend this to serve `templates/dashboard/js/*.js` and `templates/dashboard/styles.css`.

### Module pattern
Since there's no build step, use simple `<script>` tags (not ES modules) to keep it zero-config. Each JS file attaches its functions to a shared namespace or the global scope (as they do now). Load order matters:
1. Alpine.js (CDN, defer)
2. state.js (Alpine store setup)
3. utils.js (shared helpers)
4. api.js (fetch wrappers)
5. Feature scripts (terminal, sidebar, spec-drawer, etc.)
6. View scripts (monitor, pipeline, settings, statistics, logs)
7. init.js (polling, event listeners — must be last)

### Alternative: ES modules
If the browser import map is acceptable, use `<script type="module">` with relative imports. This gives proper encapsulation but requires the server to set correct MIME types. Both approaches work — pick whichever is simpler.

### CSS extraction
Move the `<style>` block contents to `styles.css`. Replace with `<link rel="stylesheet" href="/assets/styles.css">`. The server already handles `/assets/*` routing.

## Dependencies
- Feature 91 (fix ctx regressions) — codebase should be stable first
- Should be done BEFORE feature 90 (Alpine rewrite) — easier to rewrite pipeline.js as a separate file than as part of a 4K monolith

## Out of Scope
- Rewriting any view logic (that's feature 90)
- Adding a build step (webpack, vite, etc.)
- Changing the Alpine.js architecture
- Splitting the backend AIGON server code (already done in feature 86)

## Open Questions
- Should we use `<script>` tags or ES modules (`import/export`)?
- Should the JS files be concatenated in production for performance, or is the overhead negligible for a local dashboard?

## Related
- Feature 90: rewrite-pipeline-kanban-to-alpine (should come after this)
- Feature 86: extract-utils-into-domain-modules (completed — established the pattern)
- Dashboard HTML: `templates/dashboard/index.html` (4,057 lines)
