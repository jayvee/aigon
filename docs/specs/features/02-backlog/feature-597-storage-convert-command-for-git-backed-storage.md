---
complexity: medium
set: git-backed-storage-hardening
depends_on: [596]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-26T00:38:28.659Z", actor: "cli/feature-prioritise" }
---

# Feature: storage convert command for git backed storage

## Summary

Add a safe, explicit conversion command for existing repos that want to opt into git-ref SpecStore. Today conversion is manual: edit `.aigon/config.json` with `storage.backend: "git-ref"` and run `aigon storage sync`. That is acceptable for maintainer testing, but users need a guided command that validates the remote, writes config, imports existing local workflow events, pushes refs, and reports what changed.

## User Stories

- [ ] As a user, I can run one command to convert an existing local Aigon repo to git-ref storage.
- [ ] As a user, the command validates remote access before changing config so I do not half-convert a repo.
- [ ] As a maintainer, conversion is idempotent and safe to rerun after interruption.

## Acceptance Criteria

- [ ] New CLI surface exists, either `aigon storage convert --backend=git-ref --remote=origin` or a similarly explicit subcommand under `aigon storage`.
- [ ] The command refuses to run when the repo is not an Aigon repo, has no Git remote, or cannot push to the target remote, unless `--dry-run` is used.
- [ ] `--dry-run` reports the planned config change, existing numeric local workflow refs to import, and remote/ref-prefix targets without writing.
- [ ] Successful conversion writes `.aigon/config.json` storage config, runs `storage sync`, imports existing numeric local projection events, and reports imported key count.
- [ ] Running the command again is idempotent and reports that the repo is already configured.
- [ ] A rollback hint is printed: set `storage.backend` back to `local` to stop using git-ref storage; existing refs are not deleted automatically.
- [ ] Unit/integration tests cover dry-run, missing remote, existing config, URL remote, and first-enable import.

## Validation

```bash
node -c aigon-cli.js
node tests/unit/spec-store-git-ref.test.js
npm run test:related -- lib/commands/storage.js lib/spec-store
```

## Technical Approach

Extend `lib/commands/storage.js` with a `convert` subcommand. Keep conversion small and transparent: it should write project config and call existing `createSpecStore().sync()` rather than inventing a separate import path.

Use `resolveStorageConfig()` and config helpers if available; avoid hand-editing JSON in multiple places. Preserve existing config keys and formatting as much as practical. Validate `git remote get-url`, fetch, and push permissions to `refs/aigon/*` before finalizing.

## Dependencies

- depends_on: dashboard-storage-status-and-lease-visibility

## Out of Scope

- Deleting git-ref storage refs.
- Migrating arbitrary legacy non-numeric workflow ids.
- Making conversion automatic during `aigon apply`.

## Open Questions

- Should the command support `--backend=local` as a formal "stop using git-ref" path, or should that remain manual config editing?

## Related

- Set: git-backed-storage-hardening
- Prior features: F573-F578
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="3268" height="132" viewBox="0 0 3268 132" role="img" aria-label="Feature dependency graph for feature 597" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-597" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 2344 66 C 2384 66, 2384 66, 2424 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-597)"/><path d="M 2044 66 C 2084 66, 2084 66, 2124 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-597)"/><path d="M 1744 66 C 1784 66, 1784 66, 1824 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-597)"/><path d="M 1444 66 C 1484 66, 1484 66, 1524 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-597)"/><path d="M 1144 66 C 1184 66, 1184 66, 1224 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-597)"/><path d="M 844 66 C 884 66, 884 66, 924 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-597)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-597)"/><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-597)"/><path d="M 2644 66 C 2684 66, 2684 66, 2724 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-597)"/><path d="M 2944 66 C 2984 66, 2984 66, 3024 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-597)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#573</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore architecture fo…</text><text x="36" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#574</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">deprecate feedback into r…</text><text x="336" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#575</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">repo wide spec identity k…</text><text x="636" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="924" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="936" y="48" font-size="14" font-weight="700" fill="#0f172a">#576</text><text x="936" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore local adapter</text><text x="936" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="1224" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="1236" y="48" font-size="14" font-weight="700" fill="#0f172a">#577</text><text x="1236" y="70" font-size="13" font-weight="500" fill="#1f2937">git ref specstore backend</text><text x="1236" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="1524" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="1536" y="48" font-size="14" font-weight="700" fill="#0f172a">#578</text><text x="1536" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore sync leases and…</text><text x="1536" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="1824" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="1836" y="48" font-size="14" font-weight="700" fill="#0f172a">#595</text><text x="1836" y="70" font-size="13" font-weight="500" fill="#1f2937">canonical stats sync for …</text><text x="1836" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="2124" y="24" width="220" height="84" rx="12" ry="12" fill="#dbeafe" stroke="#2563eb" stroke-width="2"/><text x="2136" y="48" font-size="14" font-weight="700" fill="#0f172a">#596</text><text x="2136" y="70" font-size="13" font-weight="500" fill="#1f2937">dashboard storage status …</text><text x="2136" y="90" font-size="12" fill="#475569">in-progress</text></g><g><rect x="2424" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="2436" y="48" font-size="14" font-weight="700" fill="#0f172a">#597</text><text x="2436" y="70" font-size="13" font-weight="500" fill="#1f2937">storage convert command f…</text><text x="2436" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="2724" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="2736" y="48" font-size="14" font-weight="700" fill="#0f172a">#598</text><text x="2736" y="70" font-size="13" font-weight="500" fill="#1f2937">git backed storage two cl…</text><text x="2736" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="3024" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="3036" y="48" font-size="14" font-weight="700" fill="#0f172a">#599</text><text x="3036" y="70" font-size="13" font-weight="500" fill="#1f2937">document specstore git re…</text><text x="3036" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
