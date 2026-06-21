---
complexity: very-high
set: specstore-git-backed-storage
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-21T13:13:40.321Z", actor: "cli/feature-prioritise" }
---

# Feature: specstore architecture foundation

## Summary
Define Aigon's next storage architecture around a `SpecStore` boundary. Aigon is an SDD tool, so the durable work object should be a spec, not a generic entity or a workflow-specific file path. This feature introduces the vocabulary, module boundary, and non-behavior-changing local implementation skeleton that later features can build on.

## User Stories
- [ ] As a maintainer, I can point implementers at one storage boundary for durable spec state instead of having them read scattered workflow path/file code.
- [ ] As an agent, I can tell that specs are the top-level durable objects and feature/research are spec kinds.
- [ ] As a future backend implementer, I can add a storage backend without changing command modules, dashboard collectors, and workflow transition logic directly.

## Acceptance Criteria
- [ ] A design note is added under `docs/` describing the target model: `Spec`, spec kinds (`feature`, `research`), spec keys (`F42`, `R43`), events, snapshots, leases, indexes, and projections.
- [ ] The design explicitly states that feedback is not a top-level spec kind; customer feedback is represented as research origin/source metadata.
- [ ] A `lib/spec-store/` module exists with a documented interface and a local backend placeholder/wrapper, but no Git-ref backend behavior yet.
- [ ] The interface is spec-shaped, not generic CRUD: read/list specs, read/append events, read/write snapshots, lock specs, sync, health.
- [ ] Existing workflow-core callers are not migrated in this feature unless needed for the skeleton; behavior remains unchanged.
- [ ] Tests or syntax checks cover the new module export and ensure it can be required without side effects.
- [ ] Existing `npm test` and `node -c aigon-cli.js` still pass.

## Validation
```bash
node -c aigon-cli.js
npm test
```

## Technical Approach
- Add `lib/spec-store/index.js` plus focused files for interface validation, spec key parsing/formatting, and local backend construction.
- Keep the first implementation deliberately thin: it may delegate to current workflow path/event/snapshot helpers.
- Document the intended layering:
  - `SpecStore` owns durable storage protocol.
  - workflow-core owns lifecycle semantics.
  - spec files remain human/agent-facing projections.
  - folders are derived from lifecycle, not authoritative state.
- Avoid changing storage behavior in this feature; the value is naming the boundary and preventing later features from inventing incompatible abstractions.

## Dependencies
- None

## Out of Scope
- Moving workflow-core onto `SpecStore`
- Adding repo-wide numbering
- Removing feedback commands
- Git refs, leases, cross-machine sync, or reporting

## Open Questions
- Should the design use `refs/aigon/specs/<key>/meta` or `refs/aigon/specs/<uuid>/meta` as the long-term Git-ref path? Capture a recommendation, but do not implement it here.

## Related
- Set: specstore-git-backed-storage
