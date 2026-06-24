---
complexity: high
set: specstore-git-backed-storage
depends_on: [574]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-21T13:13:40.844Z", actor: "cli/feature-prioritise" }
---

# Feature: repo wide spec identity keys

## Summary
Introduce repo-wide spec identity keys such as `F42` and `R43` so Aigon can reference all specs through one numbering model while retaining clear feature/research prefixes for users.

## User Stories
- [ ] As a user, I can refer to a spec by an unambiguous key like `F42` or `R43`.
- [ ] As a user, I can see feature and research items in one timeline without duplicate numeric IDs.
- [ ] As a storage backend implementer, I can store specs under one namespace rather than separate feature/research databases.

## Acceptance Criteria
- [ ] A spec identity model is implemented with at least `{ key, number, kind, slug }` for new specs, exposed by a single centralized module (e.g. `lib/spec-identity.js`) that does **not** depend on specstore internals (573/576 are not dependencies of this feature).
- [ ] New specs receive display keys (`F<number>`, `R<number>`). **Decision (resolves the Open Question below):** numbering stays per-kind — `F<n>` reuses the existing feature sequence and `R<n>` the research sequence; no repo-wide renumber and no historical renumber. The display key is a presentation layer over the current numeric ID, so `F575` and feature `575` denote the same spec.
- [ ] Existing `feature-<id>-...` and `research-<id>-...` filename references and references continue to resolve unchanged.
- [ ] A single resolver accepts all of: bare numeric `575` (kind inferred from context where required), `F575`, `feature-575`, `R43`, `research-43`. Ambiguous bare-numeric input at a kind-agnostic call site is rejected with a clear error rather than silently guessing a kind.
- [ ] Dashboard/status output renders display keys (`F575`/`R43`) while the underlying engine/workflow IDs remain numeric and unchanged; no engine state is rewritten by this feature.
- [ ] `depends_on` frontmatter and the dependency-graph renderer stay numeric-only in this feature; prefixed keys such as `F574` are explicitly out of scope here. Today `parseNumericArray` in `lib/cli-parse.js` and the dep-graph generator assume numeric IDs, and this feature does not change that behavior.
- [ ] The identity layer is centralized; commands do not hand-roll `feature`/`research` ID parsing in new code.
- [ ] Tests cover parsing and resolving `F42`, `R43`, legacy `feature-42`/numeric `42`, legacy `research-43`, and the ambiguous bare-numeric rejection path.

## Validation
```bash
node -c aigon-cli.js
npm run test:core
```
The test suite must include the identity parse/resolve cases listed in the Acceptance Criteria.

## Technical Approach
- Add identity helpers under `lib/spec-store/` or a closely related module.
- Avoid a forced historical renumber unless explicitly chosen and tested; a compatibility transition is acceptable.
- Prefer display keys in UI and logs, but keep current workflow IDs readable by existing code during the transition.
- Document the migration path from per-kind numeric IDs to repo-wide display keys.

## Dependencies
- depends_on: deprecate-feedback-into-research-origins

## Out of Scope
- Git-ref storage
- Changing session naming semantics unless required for display-only labels
- Removing legacy numeric ID support

## Open Questions
- ~~Should old specs be renumbered into one global sequence, or should global sequencing apply only to newly created specs?~~ **Resolved:** no renumber. Display keys are a per-kind presentation layer (`F<n>`/`R<n>`) over the existing numeric IDs; `F575` ≡ feature `575`. See Acceptance Criteria.

## Related
- Set: specstore-git-backed-storage
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="1768" height="132" viewBox="0 0 1768 132" role="img" aria-label="Feature dependency graph for feature 575" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-575" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-575)"/><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-575)"/><path d="M 844 66 C 884 66, 884 66, 924 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-575)"/><path d="M 1144 66 C 1184 66, 1184 66, 1224 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-575)"/><path d="M 1444 66 C 1484 66, 1484 66, 1524 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-575)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#573</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore architecture fo…</text><text x="36" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#574</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">deprecate feedback into r…</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#dbeafe" stroke="#f59e0b" stroke-width="3"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#575</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">repo wide spec identity k…</text><text x="636" y="90" font-size="12" fill="#475569">in-progress</text></g><g><rect x="924" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="936" y="48" font-size="14" font-weight="700" fill="#0f172a">#576</text><text x="936" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore local adapter</text><text x="936" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="1224" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="1236" y="48" font-size="14" font-weight="700" fill="#0f172a">#577</text><text x="1236" y="70" font-size="13" font-weight="500" fill="#1f2937">git ref specstore backend</text><text x="1236" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="1524" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="1536" y="48" font-size="14" font-weight="700" fill="#0f172a">#578</text><text x="1536" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore sync leases and…</text><text x="1536" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
