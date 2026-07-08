---
complexity: high
set: close-integrity
depends_on: [644]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-08T12:41:35.566Z", actor: "cli/feature-prioritise" }
---

# Feature: close-integrity-3-escalation-engine-state

## Summary
When a code reviewer finds something beyond a safe review patch, the convention is to write an `ESCALATE:` marker into the implementation log's review notes. Today that marker is inert prose: nothing parses it, nothing blocks on it, nothing shows it to the operator. Proven cost: F630's reviewer wrote `ESCALATE:architectural — Phase B is still materially short of the spec…` (2026-07-08) and the feature **closed as done anyway**, leaving 39 unfixed config-cluster cycles silently baselined; the operator learned of it only from a manual post-set review, and undoing it took a dedicated follow-up feature (F643). This feature makes escalation a first-class workflow signal: review-notes `ESCALATE:` markers become a `review.escalation_raised` engine event that **blocks `feature-close` until the operator dispositions it** — accept-as-is (with reason), spawn a follow-up feature, or reopen for revision — using the disposition patterns the pipeline already has (F530 accept/revert/modify framing).

## User Stories
- [ ] As an operator, a reviewer escalation reaches me as a visible, blocking dashboard state — a feature with an open escalation cannot quietly become "done".
- [ ] As an operator, I disposition an escalation in one action: accept (recorded with my reason), file follow-up (feature created and linked, then close proceeds), or send back for revision (existing revise cycle).
- [ ] As a reviewer agent, writing `ESCALATE:<category> — <reason>` is still all I do — the pipeline picks it up; no new tooling on my side.

## Acceptance Criteria
- [ ] Marker contract documented and parsed: `ESCALATE:<category>` (categories at minimum `architectural`, `security`, `scope`, `spec-shortfall`) followed by free-text reason, in the `## Code Review` section of the implementation log. Parser tolerant of list prefixes/bold; single owner module (audit `lib/spec-review-state.js` first — review-notes shaping already lives near there).
- [ ] On review completion (the same write path that records review-complete signals — trace it end-to-end before wiring, per trace-full-flows discipline), each marker appends a `review.escalation_raised` engine event `{escalationId, category, reason, reviewerAgentId, logPath, lineNumber}`. `escalationId` is stable for the marker so re-running record/doctor paths is idempotent. Projector exposes `openEscalations[]` on the snapshot.
- [ ] `feature-close` refuses to complete while `openEscalations` is non-empty — exits non-zero naming each escalation and the disposition commands. Integrates with the close-integrity-1 phase ordering (escalation check runs before merge — no point merging what the operator may reopen).
- [ ] Disposition paths (CLI first, dashboard buttons wired to the same commands per the read-only rule — dashboard renders server-owned `validActions`, actions go through the existing action-command path; eligibility lives beside `feature-workflow-rules`, not in frontend conditionals):
  - `aigon feature-escalation accept <ID> <n> --reason "…"` → `review.escalation_accepted` event; close unblocks.
  - `aigon feature-escalation follow-up <ID> <n> --name <slug>` → creates a standalone feature (spec pre-filled from the escalation reason, `depends_on` prior work noted in prose), records `review.escalation_spun_off` with the new feature id; close unblocks.
  - `aigon feature-escalation reopen <ID> <n> --reason "…"` → records `review.escalation_reopened` and routes into the existing post-review revise/disposition cycle rather than a new mechanism.
- [ ] Dashboard: pipeline card shows an escalation badge (consult `docs/card-design-wireframe.html` and existing dashboard styling before any visual change); spec drawer Status/Events tabs list escalations with disposition state. `stateRenderMeta` extended if a new `currentSpecState` is introduced — and if one is, EVERY site in AGENTS.md § "Adding a currentSpecState" is touched. Default decision for v1: use snapshot data + close guard WITHOUT a new lifecycle state unless implementation proves the machine cannot express it.
- [ ] Autonomous flows respect it: `feature-autonomous` / set-conductor treat an open escalation like awaiting-input (notify operator, pause sequence) — never auto-accept.
- [ ] Tests: marker → event → close blocked; each disposition unblocks with the right event trail; non-escalating reviews unaffected; autonomous pause path covered (`// REGRESSION:` per T2 citing the F630 incident).
- [ ] Docs: development_workflow.md (reviewer contract + operator dispositions), AGENTS.md reviewer instructions name the exact marker syntax, architecture.md workflow-state section updated.

## Validation
```bash
npm run test:iterate
```

## Technical Approach
Engine-first, per the F432 precedent: append events before any UI affordance exists. The riskiest design choice is state vs data — a full new `currentSpecState` touches ~10 documented sites; an `openEscalations` snapshot field + close-guard needs none of them and degrades gracefully for pre-existing rows (missing field = no escalations). Review-notes parsing must run on the real artefact the reviewer writes (the `docs(review):` commit into the implementation log) — build the reproducer from F630's actual log first. Restart the dashboard server after `lib/*.js` edits; browser-verify after any card/drawer change; screenshots to `./tmp/`.

## Dependencies
- depends_on: close-integrity-1-post-merge-gate

## Out of Scope
- Auto-triaging or auto-fixing escalations (operator judgment is the point).
- Escalations from implementation (non-review) agents — reviewers only in v1.
- Research-close escalations (research already has a mandatory operator decision step).
- Retro-parsing old logs.

## Open Questions
- ~~Should `accept` require a reason string?~~ — resolved: yes; all three disposition commands carry `--reason` in their acceptance-criteria shapes (accept/reopen explicitly; follow-up derives its reason from the escalation it spins off). The reason is the audit trail distinguishing a decision from a dismissal.
- Multiple escalations in one review: disposition individually or as a batch? Recommend individually (they may have different answers), with a `--all` convenience.

## Related
- Prior work: F432 (engine-first close-recovery precedent), F530 (accept/revert/modify disposition framing), F354 (spec-review stage contract — the pattern for close guards with clear CLI messaging), `lib/state-render-meta.js` (server-owned render metadata), `lib/feature-set-workflow-rules.js` (validActions pattern for dashboard buttons).
- Incident evidence: F630 review log `ESCALATE:architectural` ignored at close (2026-07-08); remediation cost = F643.
- Set: close-integrity.
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="868" height="132" viewBox="0 0 868 132" role="img" aria-label="Feature dependency graph for feature 646" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-646" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-646)"/><path d="M 244 66 C 377 66, 491 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-646)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-646)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#644</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">close integrity 1 post me…</text><text x="36" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#646</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">close integrity 3 escalat…</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#647</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">close integrity 4 criteri…</text><text x="636" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
