# Feature: dashboard-route-table-extract-api-handlers

## Summary
Extract the 20+ inline API handlers from dashboard-server.js (2,751 lines) into a route table pattern. Each route becomes `{ method, path, handler(req, ctx) }` in `lib/dashboard-routes.js`. The server file keeps only: HTTP server setup, WebSocket relay, static file serving, and a generic dispatcher that handles auth, JSON serialization, error wrapping, and CORS. HTML template injection collapses to a single function.

## User Stories
- [ ] As a maintainer, I want API routes in one scannable table so I can find any endpoint in seconds
- [ ] As a contributor, I want to add a new API endpoint by adding one object to the route table
- [ ] As a reviewer, I want the HTTP server file focused on infrastructure, not business logic

## Acceptance Criteria
- [ ] `lib/dashboard-routes.js` exists: route table array + handler functions (<800 lines)
- [ ] `lib/dashboard-server.js` under 1,000 lines (from 2,751)
- [ ] Generic dispatcher in dashboard-server.js handles: method matching, path matching, auth check, JSON parse, error wrapping, 404 fallback (<80 lines)
- [ ] HTML template injection is a single function (<30 lines)
- [ ] WebSocket relay stays in dashboard-server.js (it's infrastructure)
- [ ] All dashboard API endpoints return identical responses — pure refactor
- [ ] Dashboard UI works identically after refactor (verify with Playwright screenshot)

## Validation
```bash
wc -l lib/dashboard-server.js      # expect < 1000
wc -l lib/dashboard-routes.js      # expect < 800
node --check lib/dashboard-server.js
node --check lib/dashboard-routes.js
npm test
```

## Technical Approach
- Catalog every `if (url.startsWith('/api/...'))` block in dashboard-server.js
- Define route table: `[{ method: 'GET', path: '/api/status', handler: getStatus }]`
- Generic dispatcher: match method+path, call handler, serialize response, catch errors
- Move each handler function to dashboard-routes.js with same signature `(req, ctx) => result`
- HTML injection: single `injectTemplateVars(html, vars)` replacing scattered string replacements

## Dependencies
- None — pure internal refactor

## Out of Scope
- Adding new API endpoints
- Changing the WebSocket protocol
- Modifying dashboard-status-collector.js or dashboard-status-helpers.js
