---
complexity: high
set: close-integrity
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-08T12:41:35.225Z", actor: "cli/feature-prioritise" }
---

# Feature: close-integrity-1-post-merge-gate

## Summary
`feature-close`'s deploy gate runs in the worktree, **before** the merge — so each feature is verified in isolation and the merged combination is verified by nobody. This is not hypothetical: after both the dash-arch and be-arch sets closed 100% "done" (2026-07-08), main was red — five distinct failures, all cross-feature merge interactions (a guard added in one worktree tripping over an AGENTS.md row merged from another; a static-guard reading `index.html` script tags that a sibling feature had moved to ESM imports; lint rules contradicting a boundary rule). Every failure was invisible to every per-feature gate and was found only by a manual post-set review. This feature moves the moment of truth: after the merge to the default branch, `feature-close` runs a **post-merge verification gate on merged main** and only emits `feature.closed` if it passes. On failure, the close enters the existing `close_recovery_in_progress` machinery (F432) with the gate output attached — the feature is visibly *not done* until merged main is green.

## User Stories
- [ ] As an operator, when a feature shows "done" on the dashboard, merged main passed the deploy gate with that feature's changes included — not just the worktree snapshot from before the merge.
- [ ] As an operator, when a merge interaction breaks main, I find out at close time via a blocked close + dashboard state, not days later via a manual review or a broken dashboard.
- [ ] As an implementing agent, a post-merge failure hands me the failing gate output and a recovery path (fix on main, re-run, complete the close) instead of silently completing.

## Acceptance Criteria
- [ ] `feature-close` sequence becomes: merge → run post-merge gate on the merged default branch → only then `feature.closed` + spec move + worktree cleanup. The worktree pre-merge gate remains (fail fast before merging junk); the post-merge gate is the final authority.
- [ ] Post-merge gate command is configurable (`featureClose.postMergeGate`, default `npm run test:core`) with an explicit rationale documented: core (not full browser) by default to keep close latency sane; repos can set `test:deploy`. `featureClose.postMergeGate: false` opts out (and the close output says so loudly).
- [ ] On post-merge failure: the close does NOT complete. It records a `feature.close_gate_failed` workflow event (payload: gate command, exit code, tail of output, merged commit sha) and enters `close_recovery_in_progress` (reuse F432 state + `returnSpecState` semantics — do not invent a parallel state). The dashboard card shows the existing close-failure affordances with the gate output reachable from the drawer.
- [ ] Recovery path documented and working end-to-end: operator/agent fixes main (directly or via the recovery session), re-runs `aigon feature-close <ID>` (or the recovery completion path), which re-runs the post-merge gate and completes.
- [ ] The merge itself is never auto-reverted — main keeps the merge commit; the gate gates *the claim of done*, not the merge. (Auto-revert is explicitly out of scope; see below.)
- [ ] Set-conductor behaviour: a member failing its post-merge gate halts the set sequence (the next member would build on a red main) with a clear operator notification — verify with the conductor's existing pause/notify machinery.
- [ ] Non-repo-breaking guarantees preserved: `.env.local` filtering, autostash recovery, and the F234 dashboard-invoked restart-marker path all still work; the gate runs after stash-pop so user WIP does not pollute it (document the interaction in the log).
- [ ] Tests: integration test with a fixture repo where two features individually pass but their merge fails the gate — first close completes, second close blocks in `close_recovery_in_progress` with the event recorded (`// REGRESSION:` per T2). Plus a happy-path test that the event sequence and timing fields are unchanged when the gate passes.
- [ ] Docs: `.aigon/docs/development_workflow.md` (source in `templates/docs/`), AGENTS.md close-path notes, and `docs/architecture.md` describe the new sequence. Remember rule 10: the templates/docs copy must stay target-repo-generic (the gate command comes from config, never assumes npm).

## Validation
```bash
npm run test:iterate
```

## Technical Approach
The seam is `lib/feature-close.js` — the phase list after `mergeFeatureBranch` already computes `preMergeBaseRef` and runs post-merge phases (stats snapshot, transcript capture, restart-if-lib-changed); insert the gate phase before `entityCloseFinalize`/`feature.closed` emission. Reuse the F432 `close_recovery_in_progress` write path (`recordSpecReviewStarted`-style engine-first event append) rather than new states — the projector, dashboard collector, and `parseTmuxSessionName` already understand recovery. Gate execution: spawn with output capture, bounded tail in the event payload (events.jsonl must not balloon — cap at ~4KB), full output to a log file under `.aigon/state/`. Mind the incident list in AGENTS.md § Write-Path Contract: the new event needs every consumer site from the "Adding a currentSpecState" checklist ONLY if a new state is added — prefer reusing the existing one precisely to avoid that.

## Dependencies
-

## Out of Scope
- Auto-reverting merges on gate failure (destructive, fights the operator; revisit only with evidence).
- Running the full Playwright suite post-merge by default (latency; config opt-in exists).
- Research-close (research produces no merged code; unchanged).
- CI/remote execution of the gate — this is the local pipeline.

## Open Questions
- Should consecutive set-member closes skip redundant gate runs when main hasn't changed between them (statusVersion-style fingerprint of HEAD)? Recommend: no caching in v1; correctness first.
- Where the gate's full output lives long-term (`.aigon/state/close-gates/<id>.log` vs appended to the implementation log) — pick during implementation, document in the log.

## Related
- Prior work: F432 (`close_recovery_in_progress` — the state this reuses), F234 (dashboard-invoked close restart marker), F307 (no blanket staging in close paths).
- Incident evidence: 2026-07-08 post-set reviews — dash-arch and be-arch both left main red across five failure classes; commit `66fd6563d` documents them.
- Set: close-integrity — this is the anchor feature; the other three build on the close path it reshapes.
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="568" height="132" viewBox="0 0 568 132" role="img" aria-label="Feature dependency graph for feature 644" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-644" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-644)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#644</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">close integrity 1 post me…</text><text x="36" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#645</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">close integrity 2 preauth…</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
