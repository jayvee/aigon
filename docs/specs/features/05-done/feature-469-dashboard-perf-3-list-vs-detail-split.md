---
complexity: medium
research: 47
set: dashboard-perf
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-30T00:20:18.168Z", actor: "cli/feature-prioritise" }
---

# Feature: dashboard-perf-3-list-vs-detail-split

## Summary

Split the dashboard status API into a lean list payload for polling and on-demand detail payloads for drawer/modal views. R47 found that `/api/status` over-fetches fields that are only rendered after the user opens a specific feature or research detail surface: full `workflowEvents`, `autonomousPlan`, agent-log excerpts, and full `reviewSessions` arrays. Keep the kanban/list poll focused on row/card summaries, then fetch heavy per-entity details only when the drawer opens. This reduces JSON serialization, network transfer, browser parse/render work, and establishes the list-vs-detail read-model boundary needed for later fingerprint/delta/SSE work.

## User Stories
- [ ] As a dashboard user, the kanban/list view keeps refreshing quickly without downloading every entity's full history and logs on each poll.
- [ ] As a dashboard user, opening a feature/research drawer still shows the same workflow events, plan, agent/review details, and log excerpts as before.
- [ ] As an operator debugging dashboard performance, I can clearly see which fields are list payload fields versus detail-only fields.

## Acceptance Criteria
- [ ] `/api/status` no longer includes heavy detail-only fields for every entity row/card: `workflowEvents`, `autonomousPlan`, full agent-log excerpts, full `reviewSessions` arrays, and any equivalent per-entity history/log blobs not rendered in the closed list/card state.
- [ ] `/api/status` still includes all fields required to render the current board/list without a follow-up request: id, title/slug, lifecycle/stage, current spec state, owner/winner/agent status summary, counts/badges, available action summary, set/dependency summary, timestamps, and any existing lightweight next-action metadata needed by visible cards.
- [ ] Add an on-demand details endpoint for features, e.g. `GET /api/features/:id/details`, returning the removed fields plus the lightweight header fields the drawer needs to render independently.
- [ ] Add the matching on-demand details endpoint for research, e.g. `GET /api/research/:id/details`, so research drawers do not regress or keep forcing detail fields into `/api/status`.
- [ ] The dashboard frontend fetches details when opening a feature/research drawer and caches the response per `{repoPath, entityType, id, detailFingerprint}` or equivalent invalidation key.
- [ ] If detail fetch fails, the drawer shows a recoverable inline error and the board/list remains usable; no full-dashboard crash.
- [ ] Detail payloads are scoped by repo/entity identity and reject missing or ambiguous entities with an appropriate 404/400 response rather than silently returning the wrong entity.
- [ ] Add tests covering the status payload trim, feature detail endpoint, research detail endpoint, and drawer-side fetch/error behaviour at the unit or integration level used by existing dashboard tests.
- [ ] At current user scale, serialized `/api/status` byte size drops materially from the pre-feature baseline; record before/after bytes in the implementation log. R47 estimated 60-80% reduction is plausible, but the acceptance criterion is measured reduction, not a fixed target.

## Validation
```bash
npm test -- --runInBand tests/dashboard-status-collector.test.js tests/dashboard-routes.test.js
npm run test:ui
```

## Pre-authorised
- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Technical Approach

Treat the list/detail split as a read contract change, not just a frontend optimization.

1. Audit the current `/api/status` consumers and classify every per-entity field as one of:
   - **list-required**: needed for the closed kanban/list/card view or visible badges/actions;
   - **detail-only**: only rendered in the feature/research drawer, agent log, review section, autonomous plan section, or modal detail surfaces;
   - **dead**: not rendered anywhere and safe to remove entirely.
2. Update the server read path so `collectRepoStatus` can build a lightweight row/card model without attaching detail-only blobs. Prefer explicit shaping helpers such as `toFeatureListItem()` / `toResearchListItem()` over ad-hoc `delete` calls, so future fields must choose a side of the boundary.
3. Add detail route handlers in the dashboard/server route layer. The handler should resolve repo + entity identity using the same canonical resolver/index as the status collector, then assemble the drawer model from workflow snapshots/events, review state, autonomous state, agent logs/status, and spec metadata.
4. Update the frontend drawer open path to request detail data lazily. Show the existing shell/header immediately from list data if available, then fill the detail sections once the endpoint returns.
5. Add a small client-side detail cache with explicit invalidation. The preferred key is an entity/detail fingerprint derived from list-row updated timestamps, snapshot/event mtimes, or the status fingerprint infrastructure if available by implementation time. If no reliable fingerprint exists yet, use a short in-memory cache scoped to the current poll generation and refetch on each open.
6. Measure serialized `/api/status` size before and after using the current multi-repo dashboard data. Put the numbers in the feature log.

This should compose with F468 (`dashboard-perf-2-status-cache`): F468 reduces filesystem work while building status; this feature reduces the amount of data status carries and parses. It also creates the boundary later needed by server-side status fingerprints, deltas, and SSE invalidation.

## Dependencies
- depends_on: dashboard-perf-2-status-cache

## Out of Scope
- Server-side `/api/status?since=<fingerprint>` delta or 304 responses; that is a separate status-fingerprint feature.
- SSE/WebSocket invalidation streams.
- SQLite or persistent dashboard read-model projection.
- Changing the workflow engine write model or event/snapshot file formats.
- Redesigning drawer UI content; this feature preserves existing detail content while changing when it is fetched.
- Pro dashboard analytics or commercial insight surfaces.

## Open Questions
- Should details endpoints be singular (`/api/entity/details?type=feature&id=...`) or typed (`/api/features/:id/details`, `/api/research/:id/details`)? Prefer typed routes unless existing router conventions strongly favour a generic entity route.
- What is the most reliable detail invalidation key after F468 lands: workflow snapshot updated time, events file mtime, status-row fingerprint, or a dedicated server-provided `detailFingerprint`?
- Are review sessions currently required for any closed-card badge beyond counts/status? If yes, keep only the derived badge/count in `/api/status` and move the full array to details.

## Related
- Research: #47 dashboard-perf-and-state-architecture
- Research findings: `docs/specs/research-topics/logs/research-47-cc-findings.md`, `docs/specs/research-topics/logs/research-47-cx-findings.md`, `docs/specs/research-topics/logs/research-47-gg-findings.md`
- Set: dashboard-perf
- Prior features in set: F467 `dashboard-perf-1-cold-probe-ttl`, F468 `dashboard-perf-2-status-cache`
