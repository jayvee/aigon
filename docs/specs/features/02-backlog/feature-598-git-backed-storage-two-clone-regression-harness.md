---
complexity: high
set: git-backed-storage-hardening
depends_on: [597]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-26T00:38:28.959Z", actor: "cli/feature-prioritise" }
---

# Feature: git backed storage two clone regression harness

## Summary

Add automated regression coverage for the real user promise of git-backed storage: two clones of the same repo can work on different features independently, sync through one origin, see each other's workflow state/history/stats, and block concurrent work on the same feature through leases. Current unit tests cover git-ref primitives, but the end-to-end two-machine workflow should be encoded as an integration test before relying on the capability.

## User Stories

- [ ] As a maintainer, I can run one test that simulates machine A and machine B with a bare origin and verifies git-ref storage behavior end to end.
- [ ] As a user, the documented two-machine workflow is backed by an automated regression, not only manual testing.
- [ ] As a maintainer, lease blocking, sync convergence, stats convergence, and conversion behavior are tested together.

## Acceptance Criteria

- [ ] A test fixture creates a bare origin and two working clones with Aigon initialized and git-ref storage enabled.
- [ ] The harness starts or records feature 10 on clone A and feature 11 on clone B, syncs both, and verifies both clones see both specs' canonical event histories.
- [ ] The harness verifies active lease blocking: clone B cannot acquire/start feature 10 while clone A holds an unexpired lease, except through explicit takeover.
- [ ] The harness verifies stats convergence after the canonical stats sync feature lands.
- [ ] The harness verifies conversion from local to git-ref using the new `storage convert` command.
- [ ] The test runs in CI/unit or integration without relying on real external network, real GitHub, installed agent CLIs, tmux sessions, or user global config.
- [ ] Failures print actionable context: which clone, which ref, expected holder/key/event, and relevant storage status.

## Validation

```bash
node -c aigon-cli.js
npm run test:related -- tests/integration lib/spec-store lib/commands/storage.js
```

## Technical Approach

Create an integration test using a temporary bare Git repo as origin. Use isolated project directories and `GIT_SAFE_ENV` from test helpers. Prefer direct CLI invocations for public behavior (`aigon storage convert`, `aigon storage sync`, feature lifecycle commands where lightweight) and direct SpecStore calls only where full agent/session orchestration would make the test slow or flaky.

Keep the fixture minimal but realistic: feature specs, workflow events, leases, and stats payloads. Do not spawn real agents or tmux sessions.

## Dependencies

- depends_on: storage-convert-command-for-git-backed-storage

## Out of Scope

- Browser/dashboard E2E tests.
- Testing real remote providers such as GitHub.
- Testing actual agent implementation sessions.

## Open Questions

- Should this be one comprehensive integration test or a small helper plus several focused integration tests?

## Related

- Set: git-backed-storage-hardening
- Prior features: F573-F578
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="3268" height="132" viewBox="0 0 3268 132" role="img" aria-label="Feature dependency graph for feature 598" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-598" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 2644 66 C 2684 66, 2684 66, 2724 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-598)"/><path d="M 2344 66 C 2384 66, 2384 66, 2424 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-598)"/><path d="M 2044 66 C 2084 66, 2084 66, 2124 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-598)"/><path d="M 1744 66 C 1784 66, 1784 66, 1824 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-598)"/><path d="M 1444 66 C 1484 66, 1484 66, 1524 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-598)"/><path d="M 1144 66 C 1184 66, 1184 66, 1224 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-598)"/><path d="M 844 66 C 884 66, 884 66, 924 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-598)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-598)"/><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-598)"/><path d="M 2944 66 C 2984 66, 2984 66, 3024 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-598)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#573</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore architecture fo…</text><text x="36" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#574</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">deprecate feedback into r…</text><text x="336" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#575</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">repo wide spec identity k…</text><text x="636" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="924" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="936" y="48" font-size="14" font-weight="700" fill="#0f172a">#576</text><text x="936" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore local adapter</text><text x="936" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="1224" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="1236" y="48" font-size="14" font-weight="700" fill="#0f172a">#577</text><text x="1236" y="70" font-size="13" font-weight="500" fill="#1f2937">git ref specstore backend</text><text x="1236" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="1524" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="1536" y="48" font-size="14" font-weight="700" fill="#0f172a">#578</text><text x="1536" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore sync leases and…</text><text x="1536" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="1824" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="1836" y="48" font-size="14" font-weight="700" fill="#0f172a">#595</text><text x="1836" y="70" font-size="13" font-weight="500" fill="#1f2937">canonical stats sync for …</text><text x="1836" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="2124" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="2136" y="48" font-size="14" font-weight="700" fill="#0f172a">#596</text><text x="2136" y="70" font-size="13" font-weight="500" fill="#1f2937">dashboard storage status …</text><text x="2136" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="2424" y="24" width="220" height="84" rx="12" ry="12" fill="#dbeafe" stroke="#2563eb" stroke-width="2"/><text x="2436" y="48" font-size="14" font-weight="700" fill="#0f172a">#597</text><text x="2436" y="70" font-size="13" font-weight="500" fill="#1f2937">storage convert command f…</text><text x="2436" y="90" font-size="12" fill="#475569">in-progress</text></g><g><rect x="2724" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="2736" y="48" font-size="14" font-weight="700" fill="#0f172a">#598</text><text x="2736" y="70" font-size="13" font-weight="500" fill="#1f2937">git backed storage two cl…</text><text x="2736" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="3024" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="3036" y="48" font-size="14" font-weight="700" fill="#0f172a">#599</text><text x="3036" y="70" font-size="13" font-weight="500" fill="#1f2937">document specstore git re…</text><text x="3036" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
