---
complexity: medium
set: close-integrity
depends_on: [644, 646]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-08T12:41:35.722Z", actor: "cli/feature-prioritise" }
---

# Feature: close-integrity-4-criteria-attestation

## Summary
Every feature spec carries testable `## Acceptance Criteria` checkboxes — and nothing in the pipeline ever reads them again. Agents don't tick them, close doesn't check them, the dashboard doesn't show them. Proven cost: F630 closed "done" with its central criterion (every config-cluster cycle removed from the baseline) unmet and unmentioned in the close output; the shortfall surfaced only via manual review and needed F643 to remediate. This feature makes close demand a **per-criterion attestation**: before `feature-close` completes, each acceptance criterion must be marked in the implementation log as `met` (with a one-line evidence pointer — test name, command output, commit sha), `deferred` (with a reason — which raises a `spec-shortfall` escalation via close-integrity-3's machinery so the operator dispositions it), or `dropped` (spec change, operator-granted). Not automated verification — forced, structured *honesty*: F630's "Phase B partial" would have had to appear as `deferred` line-items blocking close, not as prose buried in a log section nobody reads.

## User Stories
- [ ] As an operator, "done" means every acceptance criterion was explicitly attested with evidence, or its shortfall crossed my desk as an escalation — never silently skipped.
- [ ] As an implementing agent, `aigon feature-close` tells me exactly which criteria lack attestation and the log format to fix it — a mechanical step, not a judgment call.
- [ ] As a reviewer, the attestation table gives me a per-criterion map from claim to evidence, making "check the criteria" a lookup instead of archaeology.

## Acceptance Criteria
- [ ] Criteria parsing: reuse the existing acceptance-criteria parser (`lib/validation.js parseAcceptanceCriteria` — extend, don't duplicate) to enumerate criteria from the spec with stable indices.
- [ ] Attestation format: a `## Criteria Attestation` section in the implementation log (the 7-section log is the existing artefact — no sidecar files), one line per criterion: `1. met — integration test close-gate-merge.test.js` / `2. deferred — <reason>` / `3. dropped — spec revised, see <sha>`. Format documented in the log template and the feature-do/iterate prompt templates so agents produce it as they work, not as a close-time scramble.
- [ ] `feature-close` blocks (non-zero, actionable message listing unattested indices + the expected format) until every criterion has an attestation line. `deferred` entries raise a `spec-shortfall` escalation through close-integrity-3's event path — operator dispositions accept/follow-up/reopen before close completes.
- [ ] `met` attestations are recorded in a `feature.criteria_attested` workflow event (counts + per-criterion status, evidence strings capped) and shown in the dashboard spec drawer (criteria list with met/deferred/dropped markers — `Skill(frontend-design)` + wireframe check before UI work).
- [ ] Spec-revision interplay: criteria added by spec-revise cycles are included (parse the spec as-at-close, not as-at-start); the attestation section is append-updated, never rewritten (provenance).
- [ ] Autonomous flow: the feature-do/iterate prompt templates instruct agents to update the attestation section as each criterion lands (template changes stay target-repo-generic — rule 10; the attestation contract is aigon-lifecycle, which templates legitimately describe).
- [ ] Escape hatch mirrors close-integrity-2's: `--no-verify-criteria` exists for emergencies, warns loudly, records an event.
- [ ] Tests: fully-attested close passes; missing attestation blocks with the actionable message; `deferred` raises the escalation and blocks until dispositioned; spec-revised criteria included (`// REGRESSION:` per T2 citing the F630 incident).
- [ ] Docs: development_workflow.md close checklist, log template (`templates/` source, never installed copies), AGENTS.md testing/close discipline sections.

## Validation
```bash
npm run test:iterate
```

## Technical Approach
Three seams, all existing: `parseAcceptanceCriteria` (spec side), the implementation-log template + its section conventions (log side), and the close-phase guard ordering from close-integrity-1/-3 (attestation check runs pre-merge, beside the escalation check — cheapest first). Keep matching between criteria and attestation lines by index, not text-similarity (criteria text may be long; indices are stable within a close since the spec is parsed once). The v1 deliberately does NOT verify evidence truthfulness — the design bet, consistent with the review layer's job, is that forcing a specific falsifiable claim per criterion changes agent behaviour and gives reviewers a checkable surface; measure against the next set retro before adding heavier verification.

## Dependencies
- depends_on: close-integrity-1-post-merge-gate
- depends_on: close-integrity-3-escalation-engine-state

## Out of Scope
- Automated evidence verification (running the named tests per criterion) — possible follow-up once attestation data exists.
- Research topics (different lifecycle; synthesis already ends in a mandatory operator decision).
- Retro-attestation of closed features.
- Rewriting the 7-section log structure.

## Open Questions
- Should user stories require attestation too, or only `## Acceptance Criteria`? Recommend criteria only — stories are intent, criteria are the contract.
- Whether `feature-submit` should warn on unattested criteria (like close-integrity-2's submit-time warning) so gaps surface before review rather than at close. Recommend yes if cheap.

## Related
- Prior work: `parseAcceptanceCriteria` (`lib/validation.js`), the 7-section implementation-log convention, F332 (implementer-reasoning capture — the log is the audit artefact), close-integrity-2 (escape-hatch + event pattern), close-integrity-3 (escalation machinery consumed here).
- Incident evidence: F630 closed with its headline criterion unmet, undetected until manual review (2026-07-08).
- Set: close-integrity — the last gate: post-merge green (1), no invented authorisations (2), no ignored escalations (3), no unattested claims (4).
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="868" height="132" viewBox="0 0 868 132" role="img" aria-label="Feature dependency graph for feature 647" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-647" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 377 66, 491 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-647)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-647)"/><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-647)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#644</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">close integrity 1 post me…</text><text x="36" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#646</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">close integrity 3 escalat…</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#647</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">close integrity 4 criteri…</text><text x="636" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
