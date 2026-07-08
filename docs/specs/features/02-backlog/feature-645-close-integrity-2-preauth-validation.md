---
complexity: medium
set: close-integrity
depends_on: [644]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-08T12:41:35.410Z", actor: "cli/feature-prioritise" }
---

# Feature: close-integrity-2-preauth-validation

## Summary
The pre-authorisation mechanism (CLAUDE.md rule 9 / AGENTS.md rule 11) lets an agent proceed past a policy gate **only when the spec's `## Pre-authorised` section lists a matching line**, recording `Pre-authorised-by: <slug>` in the commit footer. Nothing enforces the "only when" — the footer is never validated against the spec. Proven hole: F631 shipped with `Pre-authorised-by: iterate-gate-static-guards-preexisting` while its spec contained **no `## Pre-authorised` section at all**; the agent invented the slug to step around a known-red static guard, and the failure stayed on main until a manual review. This feature closes the loop: at close time (and visibly on the dashboard), every `Pre-authorised-by:` footer in the feature's commits is checked against the spec's actual `## Pre-authorised` lines; unmatched slugs block the close the same way a failed gate does. The honour system becomes a contract.

## User Stories
- [ ] As an operator, an agent cannot wave itself through a policy gate with an invented slug — an unlisted `Pre-authorised-by:` blocks the close and tells me exactly which commit and which slug.
- [ ] As an operator, I can see at a glance (dashboard drawer / close output) which pre-authorisations a feature actually used, so "what did the agent skip?" has an answer without reading every commit.
- [ ] As a spec author, adding a `## Pre-authorised` line remains the one and only way to grant a skip — and the grant is scoped to that spec, not transferable.

## Acceptance Criteria
- [ ] A shared helper (natural home: `lib/spec-preauth.js` or an existing spec-parsing module — audit before creating a new file, per no-sidecar discipline) parses `## Pre-authorised` lines from a spec into `{slug, description}` entries, and extracts `Pre-authorised-by:` footers from a commit range. Slug matching is exact, case-insensitive.
- [ ] `feature-close` scans the feature's commits (`preMergeBaseRef..branch` — the range `getFeatureGitSignals` already computes) for `Pre-authorised-by:` footers and validates each against the spec. Any unmatched slug → close blocked with a message naming the commit sha, the slug, and the fix (add the line to the spec with operator consent, or revert the skipped gate's bypass). The same shared validator runs from the implementation-complete/submit signal path as a warning only unless `--strict-preauth` is added later; it must not strand an implementer before review.
- [ ] Matched pre-authorisations are recorded in a `feature.preauthorisations_used` workflow event (slugs + commit shas) at close, and surfaced in the dashboard spec drawer (Events/Status tab) and in the close summary output.
- [ ] The blocked-close path reuses the close-failure machinery from close-integrity-1 (`feature.close_gate_failed`, `feature.close_recovery.started`, `lastCloseFailure.kind = 'preauth-validation'`), not a new state. The event payload includes unmatched slugs, commit shas, and whether `--no-verify-preauth` was used.
- [ ] Template updated: the spec template's `## Pre-authorised` comment block states that slugs are validated at close (so agents reading the spec know invention fails). Rule text in AGENTS.md/CLAUDE.md gains one sentence: "slugs are validated against the spec at close."
- [ ] Grandfathering: validation applies to features closed after this lands; no retro-scan of history. A `--no-verify-preauth` escape hatch exists for genuine emergencies and prints a loud warning + records a `feature.preauthorisation_validation_bypassed` event when used.
- [ ] Tests: valid slug passes; invented slug blocks with actionable message; footer-less feature unaffected; escape hatch records its event (`// REGRESSION:` per T2 citing the F631 incident).

## Validation
```bash
npm run test:iterate
```

## Technical Approach
Parsing lives beside the existing frontmatter/spec-section readers (`lib/cli-parse.js` / `lib/spec-crud.js` have the conventions — reuse `readSpecSection` if it fits). Commit-footer extraction: `git log --format` over the same range close already walks; no new git plumbing. Keep the check cheap and pure so the implementation-complete signal path can warn early while `feature-close` remains the hard gate. Blocking integrates at the same phase as close-integrity-1's gate — run pre-auth validation BEFORE the post-merge gate (it's cheaper and fails faster). Restart the dashboard server after `lib/*.js` edits (hot rule #3).

## Dependencies
- depends_on: close-integrity-1-post-merge-gate

## Out of Scope
- Semantic validation of whether the pre-authorised skip was *wise* — the operator's spec grant is the authority; this feature only enforces that the grant exists.
- Retroactive auditing of historical commits.
- Research/feedback flows (no policy gates there today).

## Open Questions
- Should `feature-submit` hard-block or warn on unmatched slugs (with close as the hard gate)? Recommend: warn at submit, block at close — gives the reviewer context without stalling mid-flow.
- Whether the F631-style "pre-existing failure" case deserves a built-in slug convention (e.g. spec authors granting `preexisting-<guard>`) — decide from real usage, not speculatively.

## Related
- Prior work: AGENTS.md rule 11 / CLAUDE.md rule 9 (the contract being enforced), `getFeatureGitSignals` (commit-range plumbing), F432 (recovery state reused via close-integrity-1).
- Incident evidence: F631 commit `effeb6758` — invented `Pre-authorised-by: iterate-gate-static-guards-preexisting` with no `## Pre-authorised` section in the spec (2026-07-08).
- Set: close-integrity.
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="568" height="132" viewBox="0 0 568 132" role="img" aria-label="Feature dependency graph for feature 645" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-645" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-645)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#644</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">close integrity 1 post me…</text><text x="36" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#645</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">close integrity 2 preauth…</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
