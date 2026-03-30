# Feature: Dashboard Modernise

## Summary

After the infrastructure rebuild, the dashboard HTML is a single 3,600+ line file with 90+ vanilla JS render functions and no testability. This feature makes it maintainable and verifiable: incrementally adopt Alpine.js for declarative rendering (replacing imperative render functions with HTML-first directives, no build step), and add a Playwright test suite with `page.route()` mock API data so agents can verify dashboard behaviour reliably without a running Aigon instance. Together these make the dashboard the kind of codebase agents can safely modify.

## User Stories

- [ ] As an agent modifying the monitor view, I can run Playwright tests and get a pass/fail signal without starting a real AIGON server or having live feature data
- [ ] As an agent adding a new dashboard section, I can follow the Alpine.js pattern rather than writing another 100-line imperative render function
- [ ] As a developer reviewing a dashboard change, the diff shows declarative HTML attributes rather than JS string concatenation
- [ ] As a user, the dashboard behaves identically before and after — this is a refactor, not a feature change

## Acceptance Criteria

### Alpine.js adoption

- [ ] Alpine.js loaded from CDN (no build step): `<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3/dist/cdn.min.js"></script>`
- [ ] Monitor view (feature cards, agent status dots, action buttons) converted to Alpine component: `x-data`, `x-for`, `x-show`, `x-on:click`
- [ ] Pipeline/board view converted to Alpine component
- [ ] The corresponding vanilla JS render functions (`renderMonitor`, `renderBoard`, etc.) removed after each conversion
- [ ] No build step, no npm dependency added — Alpine loads from CDN, same as xterm.js was loaded
- [ ] State management: Alpine `$store` used for shared state (current data, selected repo, active view) replacing the global `state` object
- [ ] Spec drawer, analytics view, and logs view remain as vanilla JS until a follow-on feature converts them (incremental adoption, not big-bang rewrite)
- [ ] All existing operator actions continue to work after conversion

### Playwright test suite

- [ ] Playwright installed as a dev dependency (`npm install --save-dev @playwright/test`)
- [ ] Test runner added to `package.json`: `"test:dashboard": "playwright test"`
- [ ] `tests/dashboard/` directory containing at minimum:
  - `monitor.spec.js` — renders feature cards with mocked `/api/status` data, verifies agent status dots, action buttons present
  - `pipeline.spec.js` — renders pipeline board with mocked data, verifies drag-drop updates call correct API endpoint
  - `actions.spec.js` — clicking an action button POSTs to `/api/action` with correct payload
  - `analytics.spec.js` — renders stats cards and chart with mocked analytics data
- [ ] All tests use `page.route()` to intercept `/api/status` and `/api/action` — no real AIGON server required
- [ ] Tests run in headless mode by default (`playwright test --reporter=list`)
- [ ] `npm test` runs both existing tests and Playwright dashboard tests
- [ ] Tests pass reliably with no flakiness on `main` after this feature lands

### No behaviour changes

- [ ] All dashboard views (monitor, pipeline, spec drawer, analytics, logs) render identically to before
- [ ] No new dashboard features introduced
- [ ] Dashboard still works when loaded from `http://localhost:4100` (or any port from the infrastructure rebuild)

## Validation

```bash
node -c aigon-cli.js
npm test
npx playwright test --reporter=list
```

## Technical Approach

### Alpine.js conversion strategy

Convert view by view, shipping each as a self-contained step:

1. Start with the monitor view (most used, most complex render function) — move feature card HTML into `<template x-for>`, wire action buttons with `x-on:click`
2. Convert pipeline board view
3. Leave analytics, logs, spec drawer as vanilla JS — they work and are lower priority

Alpine is additive: existing vanilla JS remains valid alongside Alpine components during the transition. `x-ignore` can prevent Alpine from touching sections not yet converted.

### Playwright mock pattern

```javascript
// Every test intercepts the API instead of hitting a real server
test('monitor shows agent status', async ({ page }) => {
  await page.route('/api/status', route => route.fulfill({
    json: { repos: [{ name: 'aigon', features: [...mockFeatures] }] }
  }));
  await page.goto('http://localhost:4100');
  await expect(page.locator('.feature-card')).toHaveCount(3);
});
```

This pattern means tests run without `aigon dashboard` running — Playwright serves the static HTML directly and intercepts all fetch calls.

## Dependencies

- Feature: dashboard-infrastructure-rebuild (must land first — tests target the new server model)

## Out of Scope

- Converting analytics, logs, or spec drawer to Alpine (follow-on work)
- Server-side rendering or a full SPA rewrite
- E2E tests that require a real running Aigon instance with live data
- Visual regression screenshots (can be added incrementally after base tests are stable)

## Related

- Research 11: radar-dashboard-radical-simplification
- Feature: dashboard-infrastructure-rebuild (prerequisite)
