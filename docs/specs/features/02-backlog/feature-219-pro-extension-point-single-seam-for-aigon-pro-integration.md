# Feature: Pro extension point single seam for aigon-pro integration

## Summary

`lib/pro.js` is currently a clean 24-line lazy-require with `isProAvailable()` / `getPro()` and only ~4 call sites across the codebase. As the Pro tier becomes the strategic focus, new Pro features will want to hook into more places (lifecycle events, dashboard routes, telemetry). If each new hook follows the current pattern of scattered `if (!isProAvailable()) { ... } getPro().something(...)` calls, the open-source codebase will accumulate Pro-aware branches in unrelated files. Define a single Pro extension point now — before the proliferation begins — so Pro becomes a subscriber/plugin instead of a caller.

## Acceptance Criteria

- [ ] A single extension-point module (e.g. `lib/pro-bridge.js` or extension to `lib/pro.js`) that Pro subscribes to at startup
- [ ] One of the three patterns implemented (event bus, plugin route registration, or anti-corruption read layer — see Technical Approach)
- [ ] Existing Pro hook (`GET /api/insights` in `dashboard-server.js`) migrated to the new pattern as the proof point
- [ ] `@aigon/pro` updated in lockstep to use the new extension surface
- [ ] Documentation: `docs/architecture.md` § "Aigon Pro" updated with the extension contract
- [ ] No new `getPro()` call sites added in unrelated modules; existing scattered calls in `commands/misc.js` and `dashboard-status-collector.js` reviewed and migrated where it makes sense
- [ ] `aigon server restart` works with both `forcePro: true` and `forcePro: false`

## Validation

```bash
node -c lib/pro.js
node -c lib/dashboard-server.js
```

## Technical Approach

Pick one of three shapes (or combine). My recommendation: **start with plugin route registration** because it has the smallest blast radius and addresses the next likely Pro feature (more dashboard routes).

**Option A — Event bus (most flexible)**
- Engine emits in-process events: `feature.closed`, `feature.submitted`, `research.closed`, etc.
- `lib/pro-bridge.js` subscribes if `@aigon/pro` is installed; calls into Pro's handlers
- Open-source code emits events without knowing whether anything subscribes
- Best for: lifecycle hooks (insights generation, coaching triggers)

**Option B — Plugin route registration (smallest)**
- `dashboard-server.js` exposes `registerProRoutes(router)` once at startup
- Pro fills in `/api/insights/*`, `/api/coaching/*`, `/api/amplification/*` without dashboard knowing
- Open-source dashboard never references specific Pro endpoints
- Best for: new dashboard features

**Option C — Anti-corruption read layer**
- All Pro reads go through `lib/dashboard-status-collector.js` (already the aggregator)
- Pro never reaches into `.aigon/state/` or workflow snapshots directly
- Best for: insights/analytics that need engine data
- **Depends on Issue 1 being done first** (feature-move-dashboard-direct-fs-reads-into-status-collector)

**Recommended sequence:**
1. Implement Option B first (plugin route registration) — migrate `/api/insights` as the proof point
2. Add Option A (event bus) when the next Pro feature needs lifecycle hooks
3. Option C falls out of Issue 1 naturally

## Dependencies

- `@aigon/pro` repo will need a coordinated change to use the new extension surface
- Option C depends on Issue 1 from the modularity review

## Out of Scope

- Building actual new Pro features — this is purely the infrastructure for them
- Removing existing scattered `getPro()` calls in non-dashboard modules unless they fit the chosen pattern
- Public plugin API for third-party extensions — Pro is the only consumer for now

## Open Questions

- Which option does Pro most need first? (Likely B — more dashboard surface)
- Should the extension point live in `lib/pro.js` or a new `lib/pro-bridge.js`?
- Versioning: how do open-source and Pro coordinate when the extension contract changes? (Probably semver on aigon, with `@aigon/pro` declaring a peer-dep range)

## Related

- Modularity Review: `docs/modularity-review/2026-04-06/modularity-review.md` — Issue 4 (Minor — anticipatory)
- Current integration: `lib/pro.js`, `lib/dashboard-server.js` (`/api/insights` route)
- Pro repo: `~/src/aigon-pro` (private)
- Architecture doc: `docs/architecture.md` § "Aigon Pro"
