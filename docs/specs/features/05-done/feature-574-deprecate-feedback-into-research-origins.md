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
- [ ] Research spec template (`templates/specs/research-template.md`) and `.aigon/docs` support optional `origin: customer-feedback`, `source`, `reporter`, and `feedback_refs` metadata, parsed via the single frontmatter source of truth (`lib/cli-parse.js parseFrontMatter`) — no second parser. Fields are optional; absence does not change current research behaviour.
- [ ] `feedback-create`, `feedback-list`, and `feedback-triage` print a deprecation notice (first line of output) pointing users to `research-create` / research origins; commands still function so existing repos do not break.
- [ ] Feedback is removed from the default dashboard board (no feedback column/cards in the repo-wide view) and from the primary `aigon help` output; any remaining surface is explicitly labelled `legacy`.
- [ ] A migration path — name the entrypoint explicitly (e.g. `aigon feedback-migrate` and/or a `doctor --fix` scan of `docs/specs/feedback/**/feedback-*.md`) — converts each feedback file into a research spec in `docs/specs/research-topics/01-inbox/`, allocating fresh research IDs from the research counter (this is creation, not renumbering — see Out of Scope).
- [ ] Migration preserves every feedback field, mapped explicitly: `title`, summary/body sections, `type`, `severity`, `tags`, `votes`, `source`, `reporter`, `duplicate_of`, `linked_features`, `linked_research`, and triage notes. Fields with no research equivalent are carried into `origin`/`source`/`feedback_refs` frontmatter or the body, never dropped.
- [ ] Migration defines an explicit status mapping from feedback lifecycle (`inbox`/`triaged`/`actionable`/`done`/`wont-fix`/`duplicate`) to research folders (`01-inbox`/`02-backlog`/`03-in-progress`/`04-in-evaluation`/`05-done`/`06-paused`). `wont-fix` and `duplicate` have no research equivalent — specify their target folder and how the original disposition is preserved (e.g. a status note + `feedback_refs`).
- [ ] Migration is idempotent: a stable idempotency key (e.g. `feedback_refs` containing the source feedback id/path) prevents re-running from creating duplicate research specs. Acceptance is verified by running the migration twice and asserting the research count is unchanged on the second run.
- [ ] Documentation explains the new model: feedback is an input to research; research may recommend zero or more features.
- [ ] Existing repos with feedback files receive a clear legacy/migration message rather than silent data loss.

## Validation
```bash
node -c aigon-cli.js
npm run test:core
# Migration idempotency: count research specs, run migrate twice, assert no growth on 2nd run
aigon feedback-migrate            # or: aigon doctor --fix
BEFORE=$(find docs/specs/research-topics -name 'research-*.md' | wc -l)
aigon feedback-migrate            # second run must be a no-op
AFTER=$(find docs/specs/research-topics -name 'research-*.md' | wc -l)
test "$BEFORE" = "$AFTER"
# Deprecation notice present
aigon feedback-create "x" 2>&1 | grep -i 'deprecat'
```

## Technical Approach
- Prefer staged deprecation over immediate hard deletion.
- Keep migration idempotent: repeated runs should not duplicate migrated research specs (idempotency key = source feedback ref in `feedback_refs`).
- Add origin/source metadata support to research templates and the shared parser (`lib/cli-parse.js parseFrontMatter`) without making it required; do not introduce a second frontmatter parser.
- Reduce, but do not prematurely delete, compatibility shims until tests and docs are updated.
- Treat this as domain cleanup required before broad storage abstraction work.

### Ownership / layering
This is **read-side + CLI + template + migration** work; it must not add new workflow-core engine state. Feedback's bespoke 6-folder lifecycle (`lib/feedback.js`, `lib/commands/feedback.js`) is what diverges from workflow-core — migration retires that divergence by re-homing feedback into the existing research lifecycle, not by porting feedback states into the engine. Touch points already referencing feedback (e.g. `lib/dashboard-status-collector.js`, `lib/dashboard-action-command.js`, `lib/action-scope.js`, `lib/templates.js`, `lib/commands/help`/`misc.js`) should be audited so feedback drops out of the default board and help without leaving half-states (cf. F294 write-path contract).

### Existing `afbc`/`afc` distinction
The repo currently reserves feedback (`afbc`) for genuine user voice vs agent-discovered work (`afc`). The new model folds that distinction into research `origin`: customer-sourced research carries `origin: customer-feedback` + `reporter`/`source`; agent-initiated research omits it. Confirm docs reflect this so the captured signal (who reported it) is not lost.

## Dependencies
- depends_on: specstore-architecture-foundation

## Out of Scope
- Integrations with Linear, Jira, support tools, or survey products
- Git-ref storage
- Renumbering existing feature/research specs

## Open Questions
- Should deprecated feedback commands be retained for one release or removed immediately after migration support lands? **Default resolution per Technical Approach: retain for one release with a deprecation notice, then remove in a follow-up; do not hard-delete `lib/feedback.js` paths in this feature.**
- `wont-fix` / `duplicate` feedback have no research-lifecycle equivalent — confirm the target folder (proposed: `05-done` with a status note recording the original disposition) before implementing the status map.

## Related
- Set: specstore-git-backed-storage
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="3268" height="132" viewBox="0 0 3268 132" role="img" aria-label="Feature dependency graph for feature 574" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-574" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-574)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-574)"/><path d="M 844 66 C 884 66, 884 66, 924 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-574)"/><path d="M 1144 66 C 1184 66, 1184 66, 1224 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-574)"/><path d="M 1444 66 C 1484 66, 1484 66, 1524 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-574)"/><path d="M 1744 66 C 1784 66, 1784 66, 1824 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-574)"/><path d="M 2044 66 C 2084 66, 2084 66, 2124 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-574)"/><path d="M 2344 66 C 2384 66, 2384 66, 2424 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-574)"/><path d="M 2644 66 C 2684 66, 2684 66, 2724 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-574)"/><path d="M 2944 66 C 2984 66, 2984 66, 3024 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-574)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#573</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore architecture fo…</text><text x="36" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#f59e0b" stroke-width="3"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#574</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">deprecate feedback into r…</text><text x="336" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#575</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">repo wide spec identity k…</text><text x="636" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="924" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="936" y="48" font-size="14" font-weight="700" fill="#0f172a">#576</text><text x="936" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore local adapter</text><text x="936" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="1224" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="1236" y="48" font-size="14" font-weight="700" fill="#0f172a">#577</text><text x="1236" y="70" font-size="13" font-weight="500" fill="#1f2937">git ref specstore backend</text><text x="1236" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="1524" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="1536" y="48" font-size="14" font-weight="700" fill="#0f172a">#578</text><text x="1536" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore sync leases and…</text><text x="1536" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="1824" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="1836" y="48" font-size="14" font-weight="700" fill="#0f172a">#595</text><text x="1836" y="70" font-size="13" font-weight="500" fill="#1f2937">canonical stats sync for …</text><text x="1836" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="2124" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="2136" y="48" font-size="14" font-weight="700" fill="#0f172a">#596</text><text x="2136" y="70" font-size="13" font-weight="500" fill="#1f2937">dashboard storage status …</text><text x="2136" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="2424" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="2436" y="48" font-size="14" font-weight="700" fill="#0f172a">#597</text><text x="2436" y="70" font-size="13" font-weight="500" fill="#1f2937">storage convert command f…</text><text x="2436" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="2724" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="2736" y="48" font-size="14" font-weight="700" fill="#0f172a">#598</text><text x="2736" y="70" font-size="13" font-weight="500" fill="#1f2937">git backed storage two cl…</text><text x="2736" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="3024" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="3036" y="48" font-size="14" font-weight="700" fill="#0f172a">#599</text><text x="3036" y="70" font-size="13" font-weight="500" fill="#1f2937">document specstore git re…</text><text x="3036" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
