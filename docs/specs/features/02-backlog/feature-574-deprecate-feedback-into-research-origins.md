---
complexity: high
set: specstore-git-backed-storage
depends_on: [573]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-21T13:13:40.593Z", actor: "cli/feature-prioritise" }
---

# Feature: deprecate feedback into research origins

## Summary
Remove feedback as a first-class Aigon lifecycle concept and represent customer feedback as a source/origin for research specs. This simplifies Aigon's domain model to two spec kinds: feature specs and research specs.

## User Stories
- [ ] As a user, I can capture customer/user feedback as research without learning a third workflow.
- [ ] As a maintainer, I no longer need to preserve a feedback lifecycle that diverges from workflow-core.
- [ ] As an agent, I can reason that all investigatory work is research, regardless of whether the input came from a maintainer or a customer.

## Acceptance Criteria
- [ ] Research spec template/docs support optional `origin: customer-feedback`, `source`, `reporter`, and `feedback_refs` metadata.
- [ ] Feedback is removed from default dashboard prominence and user-facing command help, or clearly marked legacy/deprecated where removal is unsafe in one release.
- [ ] `feedback-create`, `feedback-list`, and `feedback-triage` emit deprecation guidance pointing users to research specs.
- [ ] A migration command or doctor repair path converts existing `docs/specs/feedback/**/feedback-*.md` files into research specs while preserving title, summary, source, reporter, tags, severity, duplicate links, and status notes.
- [ ] Dashboard/read-side code no longer treats feedback as a peer of feature/research in the default repo-wide board after migration.
- [ ] Documentation explains the new model: feedback is an input to research; research may recommend zero or more features.
- [ ] Existing repos with feedback files receive a clear legacy/migration message rather than silent data loss.

## Validation
```bash
node -c aigon-cli.js
npm test
```

## Technical Approach
- Prefer staged deprecation over immediate hard deletion.
- Keep migration idempotent: repeated runs should not duplicate migrated research specs.
- Add origin/source metadata support to research templates and parser surfaces without making it required.
- Reduce, but do not prematurely delete, compatibility shims until tests and docs are updated.
- Treat this as domain cleanup required before broad storage abstraction work.

## Dependencies
- depends_on: specstore-architecture-foundation

## Out of Scope
- Integrations with Linear, Jira, support tools, or survey products
- Git-ref storage
- Renumbering existing feature/research specs

## Open Questions
- Should deprecated feedback commands be retained for one release or removed immediately after migration support lands?

## Related
- Set: specstore-git-backed-storage
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="1768" height="132" viewBox="0 0 1768 132" role="img" aria-label="Feature dependency graph for feature 574" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-574" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-574)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-574)"/><path d="M 844 66 C 884 66, 884 66, 924 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-574)"/><path d="M 1144 66 C 1184 66, 1184 66, 1224 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-574)"/><path d="M 1444 66 C 1484 66, 1484 66, 1524 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-574)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#573</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore architecture fo…</text><text x="36" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#dbeafe" stroke="#f59e0b" stroke-width="3"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#574</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">deprecate feedback into r…</text><text x="336" y="90" font-size="12" fill="#475569">in-progress</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#575</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">repo wide spec identity k…</text><text x="636" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="924" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="936" y="48" font-size="14" font-weight="700" fill="#0f172a">#576</text><text x="936" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore local adapter</text><text x="936" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="1224" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="1236" y="48" font-size="14" font-weight="700" fill="#0f172a">#577</text><text x="1236" y="70" font-size="13" font-weight="500" fill="#1f2937">git ref specstore backend</text><text x="1236" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="1524" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="1536" y="48" font-size="14" font-weight="700" fill="#0f172a">#578</text><text x="1536" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore sync leases and…</text><text x="1536" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
