---
complexity: high
set: stable-spec-layout
depends_on: [668]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-11T08:31:58.758Z", actor: "cli/feature-prioritise" }
---

# Feature: generate local lifecycle status folders as symlink views

## Summary
Preserve Aigon's filesystem-at-a-glance workflow by generating lifecycle folders containing local, disposable relative symlinks to canonical `00-specs` files. Build one idempotent status-view projector for features and research, refresh it after local lifecycle changes and remote state projection, and provide safe repair/diagnostic commands without ever treating symlinks as durable content.

## User Stories
- [ ] As an operator without the dashboard, I can open `03-in-progress` or another lifecycle folder and immediately see the relevant specs.
- [ ] As an operator, opening a lifecycle link takes me to the one canonical Markdown file rather than a copied document.
- [ ] As an operator on another machine, `aigon storage sync` updates my local lifecycle folders without touching main.
- [ ] As an operator, accidental regular files or unsafe links in generated folders are reported rather than overwritten.

## Acceptance Criteria
- [ ] Lifecycle directories retain the established numbered names while canonical files remain under `00-specs`.
- [ ] Each workflow-backed feature/research with available lifecycle state has exactly one desired relative symlink in its mapped lifecycle directory.
- [ ] Symlink targets point only into the matching entity kind's `00-specs` directory and use portable relative paths.
- [ ] Generated links are excluded from Git commits and normal canonical scans; lifecycle refresh leaves tracked files, the index, and `HEAD` unchanged.
- [ ] One projector computes the complete desired view from current snapshots and reconciles it idempotently; it does not rely on replaying incremental move intents or an applied-event ledger.
- [ ] Correct links remain untouched, obsolete managed links are removed, missing links are created, and wrong managed targets are replaced.
- [ ] A regular file, unmanaged symlink, out-of-root target, duplicate canonical identity, or ambiguous legacy file blocks that entity and produces a structured diagnostic; Aigon never deletes or overwrites it automatically.
- [ ] When canonical content is unavailable locally but remote state is known, the view may expose a clearly diagnosable broken link using canonical identity/basename metadata; doctor and dashboard report `content unavailable on this checkout`.
- [ ] A disposable manifest under `.aigon/state/` records managed paths, targets, and refresh time for safety/diagnostics, but deleting it and rebuilding produces the same view.
- [ ] View refresh runs after successful local lifecycle persistence, `aigon storage sync`, dashboard storage projection refresh, stable-layout migration, `aigon apply`, and `aigon doctor --fix`.
- [ ] `aigon spec-view refresh` explicitly rebuilds the view and returns non-zero for unsafe collisions while leaving unrelated files untouched.
- [ ] A failure to refresh the view warns with a repair command but does not roll back already-published canonical lifecycle state.
- [ ] Tests cover create, prioritise, start, pause/resume, evaluation, close, reset, remote sync, idempotent rebuild, missing targets, unsafe regular files, and feature/research parity.

## Validation
```bash
npm test
node tests/integration/two-clone-git-branch-storage.test.js
node tests/integration/spec-review-status.test.js
```

## Pre-authorised

## Technical Approach
Create a focused status-view module that maps workflow lifecycle to the existing visible stage directory names. It reads canonical identities and snapshots, builds a desired `{linkPath -> relativeTarget}` map, and reconciles only paths it can prove are Aigon-managed. Use filesystem symlink inspection rather than following links when validating or cleaning. Generate links for both local and git-branch storage from the same projection API.

Lifecycle folders should contain tracked explanatory/ignore metadata only; symlink entries remain local. Keep `00-specs` collapsed as the durable content directory while lifecycle folders provide the navigational view. Editor-specific integration is deliberately excluded.

## Dependencies
- `stable-spec-layout-3-canonical-00-specs-layout-migration`.

## Out of Scope
- VS Code/Cursor settings, extensions, recommendations, or custom Explorer views.
- Copies, hardlinks, tracked lifecycle links, or a FUSE filesystem.
- Canonical spec content synchronization outside normal Git.
- Changing lifecycle semantics.

## Open Questions
- Cross-platform fallback behaviour where symlink creation is unavailable should fail clearly or provide a portable index through a separate follow-up; it must never copy canonical Markdown.

## Related
- Current stage mapping: `lib/workflow-snapshot-adapter.js` and workflow-core path helpers.
- Current reconciliation: `lib/spec-reconciliation.js`.
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="1468" height="132" viewBox="0 0 1468 132" role="img" aria-label="Feature dependency graph for feature 669" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-669" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 844 66 C 884 66, 884 66, 924 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-669)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-669)"/><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-669)"/><path d="M 1144 66 C 1184 66, 1184 66, 1224 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-669)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#666</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">stable spec layout 1 read…</text><text x="36" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#667</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">stable spec layout 2 crea…</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#668</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">stable spec layout 3 cano…</text><text x="636" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="924" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="936" y="48" font-size="14" font-weight="700" fill="#0f172a">#669</text><text x="936" y="70" font-size="13" font-weight="500" fill="#1f2937">stable spec layout 4 gene…</text><text x="936" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="1224" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="1236" y="48" font-size="14" font-weight="700" fill="#0f172a">#670</text><text x="1236" y="70" font-size="13" font-weight="500" fill="#1f2937">stable spec layout 5 life…</text><text x="1236" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
