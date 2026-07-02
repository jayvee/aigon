---
complexity: medium
set: git-backed-storage-hardening
depends_on: [598]
# agent: cc    # optional — id of the agent that owns this spec. Used as the
#              #   default reviewer for spec-revise cycles when the operator
#              #   does not pick one explicitly. Precedence at revision time:
#              #     event payload nextReviewerId > frontmatter agent:
#              #     > snapshot.authorAgentId > getDefaultAgent().
# research: 44 # optional — id (or list of ids) of the research topic that
#              #   spawned this feature. Stamped automatically by `research-eval`
#              #   on features it creates. Surfaced in the dashboard research
#              #   detail panel under Agent Log → FEATURES.
# planning_context: ~/.claude/plans/your-plan.md  # optional — path(s) to plan file(s)
#              #   generated during an interactive planning session (e.g. EnterPlanMode).
#              #   Content is injected into the agent's context at feature-do time and
#              #   copied into the implementation log at feature-start for durability.
#              #   Set this whenever you ran plan mode before writing the spec.
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-26T00:38:29.254Z", actor: "cli/feature-prioritise" }
---

# Feature: document specstore git-ref storage

<!-- Authoring AI: set `complexity:` using this rubric before writing the spec:
       low       — config tweaks, doc-only, single-file helpers, trivial bug fixes
       medium    — standard feature with moderate cross-cutting, one command handler, small refactor
       high      — multi-file changes, new public surfaces, judgment-heavy deletion work
       very-high — architectural shifts, contract-breaking changes, new invariants, cross-cutting work that spans multiple subsystems
     At start time, model and effort defaults come from each agent's complexity-defaults
     table (not from this spec). Do not put model IDs in the spec. -->

## Summary
Document Aigon's SpecStore storage choices for maintainers and users now that the opt-in `git-ref` backend exists. The docs should explain local vs git-ref storage, how to enable and test git-ref storage, what is and is not synchronized across machines, how leases work, and which dashboard/settings surfaces expose storage state. This closes the gap where implementation docs exist in `docs/specstore-architecture.md`, but external site docs and some internal architecture references still describe only the early local-backend phase.

## User Stories
- [ ] As a user, I can decide whether a repo should stay on local storage or opt into git-ref storage.
- [ ] As a user with two machines, I can understand what Aigon state syncs through git refs, what still relies on normal Git or local cache files, and what manual checks to run before relying on it.
- [ ] As a maintainer, I can find the source-of-truth architecture notes and know which dashboard/API surfaces should expose storage backend and lease information.

## Acceptance Criteria
- [ ] Internal architecture docs are updated so `docs/architecture.md` no longer implies SpecStore is local-only or pre-git-ref; it must describe local and git-ref backends, command surfaces, leases, and projection/cache boundaries.
- [ ] `docs/specstore-architecture.md` is revised for operator clarity: include current CLI status, no dedicated `storage convert` command, "enable by config then run `aigon storage sync`", and the fact that existing numeric local workflow events are imported on first sync.
- [ ] External site docs under `site/content/` include a user-facing page or reference section for storage backends, with exact `.aigon/config.json` examples for local/default and git-ref.
- [ ] External docs explain the two-machine model: pre-write fetch/merge, event-id dedupe, leases, TTL/renewal, `--takeover`, offline mode, and push permissions for `refs/aigon/*`.
- [ ] External docs explicitly state the current boundary: workflow events/state/leases sync through git-ref storage; spec markdown/code still use normal Git; `stats.json` and stats aggregate caches are local projection/analytics artifacts unless a later feature promotes them into canonical storage.
- [ ] Command reference/help docs mention `aigon storage sync|status|doctor|report` and `aigon board --storage` if they are public surfaces.
- [ ] Dashboard docs either document the current dashboard visibility gap or are updated after any implementation work that exposes backend/lease state in settings/cards.

## Validation
<!-- Optional: commands the iterate loop runs after each iteration (in addition to project-level validation).
     Use for feature-specific checks that don't fit in the project's general checks.
     All commands must exit 0 for the iteration to be considered successful.
     Leave the block below empty or remove it if there is nothing feature-specific to run. -->
```bash
npm run test:related -- docs/specstore-architecture.md docs/architecture.md site/content
```

## Technical Approach
Start with documentation only. Audit the current implementation in `lib/spec-store/`, `lib/commands/storage.js`, `lib/spec-store/lease-coordination.js`, dashboard settings/status collectors, and the site docs tree. Update the internal docs first, then add an external user-facing storage guide/reference entry that links to command references and configuration docs.

Be precise about authority boundaries:
- Canonical git-ref storage currently stores append-only workflow and lease events at `refs/aigon/specs/<key>/events`.
- `.aigon/workflows/**` remains a local projection/read cache rebuilt from canonical events.
- `stats.json` under `.aigon/workflows/{features,research}/<id>/stats.json` and `.aigon/cache/stats-aggregate.json` are local analytics artifacts today; cross-machine parity for those metrics requires a future canonicalization/import path.
- Spec markdown and code changes are still normal Git working-tree content, not SpecStore payloads.

If dashboard visibility is implemented in the same feature, keep it small: surface resolved storage backend in settings/repo metadata and active lease holder metadata in feature detail/card payloads from server-owned read models. Do not create frontend-only state derivation.

## Dependencies
<!-- Other features, external services, or prerequisites.
     For Aigon feature dependencies use: depends_on: feature-name-slug
     This enables ordering enforcement — dependent features can't start until deps are done. -->
- Features 573-578 (`specstore-git-backed-storage`) must remain complete.
- The CLI availability fix for `aigon storage` should be present before documenting the command as public.

## Out of Scope
<!-- Explicitly list what this feature does NOT include -->
- Implementing a dedicated `aigon storage convert` command. If that lands in this set first, document it rather than implementing it here.
- Implementing canonical storage semantics for `stats.json` or stats aggregate caches. If that lands in this set first, document it rather than implementing it here.
- Implementing dashboard storage/lease visibility. If that lands in this set first, document it rather than implementing it here.
- Changing the lease model, TTLs, or takeover behavior beyond describing the implemented behavior.
- Making git-ref storage the default backend.

## Open Questions
<!-- Unresolved questions that may need clarification during implementation -->
- None known. This spec should be updated after the preceding set members land so the docs match shipped behavior.

## Related
- Set: git-backed-storage-hardening
- Prior features: F573, F574, F575, F576, F577, F578
- Internal docs: `docs/specstore-architecture.md`, `docs/architecture.md`
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="3268" height="132" viewBox="0 0 3268 132" role="img" aria-label="Feature dependency graph for feature 599" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-599" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 2944 66 C 2984 66, 2984 66, 3024 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-599)"/><path d="M 2644 66 C 2684 66, 2684 66, 2724 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-599)"/><path d="M 2344 66 C 2384 66, 2384 66, 2424 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-599)"/><path d="M 2044 66 C 2084 66, 2084 66, 2124 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-599)"/><path d="M 1744 66 C 1784 66, 1784 66, 1824 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-599)"/><path d="M 1444 66 C 1484 66, 1484 66, 1524 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-599)"/><path d="M 1144 66 C 1184 66, 1184 66, 1224 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-599)"/><path d="M 844 66 C 884 66, 884 66, 924 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-599)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-599)"/><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-599)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#573</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore architecture fo…</text><text x="36" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#574</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">deprecate feedback into r…</text><text x="336" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#575</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">repo wide spec identity k…</text><text x="636" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="924" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="936" y="48" font-size="14" font-weight="700" fill="#0f172a">#576</text><text x="936" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore local adapter</text><text x="936" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="1224" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="1236" y="48" font-size="14" font-weight="700" fill="#0f172a">#577</text><text x="1236" y="70" font-size="13" font-weight="500" fill="#1f2937">git ref specstore backend</text><text x="1236" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="1524" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="1536" y="48" font-size="14" font-weight="700" fill="#0f172a">#578</text><text x="1536" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore sync leases and…</text><text x="1536" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="1824" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="1836" y="48" font-size="14" font-weight="700" fill="#0f172a">#595</text><text x="1836" y="70" font-size="13" font-weight="500" fill="#1f2937">canonical stats sync for …</text><text x="1836" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="2124" y="24" width="220" height="84" rx="12" ry="12" fill="#dbeafe" stroke="#2563eb" stroke-width="2"/><text x="2136" y="48" font-size="14" font-weight="700" fill="#0f172a">#596</text><text x="2136" y="70" font-size="13" font-weight="500" fill="#1f2937">dashboard storage status …</text><text x="2136" y="90" font-size="12" fill="#475569">in-progress</text></g><g><rect x="2424" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="2436" y="48" font-size="14" font-weight="700" fill="#0f172a">#597</text><text x="2436" y="70" font-size="13" font-weight="500" fill="#1f2937">storage convert command f…</text><text x="2436" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="2724" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="2736" y="48" font-size="14" font-weight="700" fill="#0f172a">#598</text><text x="2736" y="70" font-size="13" font-weight="500" fill="#1f2937">git backed storage two cl…</text><text x="2736" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="3024" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="3036" y="48" font-size="14" font-weight="700" fill="#0f172a">#599</text><text x="3036" y="70" font-size="13" font-weight="500" fill="#1f2937">document specstore git re…</text><text x="3036" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
