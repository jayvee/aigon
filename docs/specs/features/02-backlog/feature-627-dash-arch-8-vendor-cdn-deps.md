---
complexity: low
set: dash-arch
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-07T06:05:20.010Z", actor: "cli/feature-prioritise" }
---

# Feature: dash-arch-8-vendor-cdn-deps

## Summary

Vendor the dashboard's remaining CDN-loaded libraries — Alpine.js, marked, Chart.js, and the chartjs-date-fns adapter bundle — into `templates/dashboard/js/vendor/`, exactly as was already done for xterm.js ("vendored locally — no CDN cold-fetch" per the existing index.html comment). Today a cold dashboard load makes four jsdelivr requests; on a train, behind a corporate proxy, or when jsdelivr hiccups, the dashboard loads with no reactivity (Alpine missing → monitor/pipeline dead), no markdown rendering in the spec drawer, and no charts — a local-first developer tool should not have a hard runtime dependency on a third-party CDN. Pinning exact vendored versions also removes the floating-major tags (`alpinejs@3`, `chart.js@4`, `marked` fully unpinned) that could break the dashboard on a CDN-side major/minor bump without any Aigon change.

## User Stories

- [ ] As a user working offline or on a flaky connection, the dashboard is fully functional — reactive views, rendered specs, charts.
- [ ] As a user, cold dashboard loads don't stall on third-party TLS handshakes.
- [ ] As a maintainer, dashboard dependency upgrades are deliberate: a version bump is a reviewed diff in the repo, not a CDN drift.

## Acceptance Criteria

- [ ] `alpinejs` (3.x), `marked`, `chart.js` (4.x UMD), and `chartjs-adapter-date-fns` (bundle) live under `templates/dashboard/js/vendor/<lib>/` with exact versions recorded in `templates/dashboard/js/vendor/VERSIONS.md` (xterm currently uses stable filenames without a versions manifest; add xterm's current version there too while touching vendor metadata).
- [ ] All `cdn.jsdelivr.net` references in `templates/dashboard/index.html` are replaced with local paths; `defer` semantics for Alpine preserved (store registration in `alpine:init` must still fire before Alpine starts — verify against the module-loading order, especially if dash-arch-4 has landed).
- [ ] Grep proves zero remaining external URLs in dashboard HTML/JS (fonts, CSS, scripts). If any other external fetch is found (favicon services, images), vendor or remove it too.
- [ ] Licenses: each vendored lib's license file/header ships alongside it (MIT for all four — include the license text). If existing xterm vendoring has no adjacent license file, add xterm's license in the same vendor metadata pass.
- [ ] npm package size: check the packed-size impact (`npm pack --dry-run`) and record it in the feature log; these four libs are ~400–600KB minified total, which is acceptable for a local-first tool — but confirm `package.json` `files`/ignore rules actually ship `templates/dashboard/js/vendor/**`.
- [ ] Offline verification: load the dashboard with network access to jsdelivr blocked (devtools request blocking or hosts-file) — all views, spec drawer markdown, and Reports charts work. Record as screenshot in `./tmp/`.
- [ ] `npm run test:browser` green (Playwright runs will get faster and stop depending on CDN availability — note any test-fixture URL references that also need updating).
- [ ] A short "upgrading vendored dashboard libs" note added to `CONTRIBUTING.md` (or wherever the xterm upgrade procedure is documented — co-locate).

## Validation

```bash
npm run test:iterate
```

## Technical Approach

- Copy minified dist files from pinned npm packages or CDN-resolved package tarballs during development time; do NOT add them as runtime `dependencies` — they are static assets, matching the xterm precedent. Record the source package/version and exact file path in `VERSIONS.md`.
- Keep filenames stable (`vendor/alpine/alpine.min.js`) and record versions in one place rather than in every filename, unless xterm's precedent says otherwise — follow the existing pattern.
- Chart.js + adapter: keep the UMD/bundle builds (the adapter bundle includes date-fns) so no module-graph work is needed regardless of whether dash-arch-4 has landed.
- This feature is independent of the rest of the set and can ship first — it's also the lowest-risk one to validate the set's e2e harness against.

## Dependencies

- None. (If dash-arch-4 lands first, coordinate on the script-tag section of index.html — trivial merge either way.)

## Out of Scope

- Upgrading any library's major version (vendor what's currently loaded, pinned).
- Bundling/minifying Aigon's own dashboard JS.
- Subresource integrity / CSP hardening (pointless once everything is same-origin).
- The docs site or any non-dashboard web surface.

## Open Questions

- Exact current CDN-resolved versions: capture what jsdelivr serves today for the floating tags and pin those (check browser network tab), so behaviour is bit-identical at switch time.

## Related

- Prior work: xterm.js vendoring (same rationale, same location, explicitly noted in index.html).
- Set: dash-arch — wave 3 (assets: 8, 9). Independent; good first-ship candidate for the set.
