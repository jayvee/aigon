---
complexity: medium
set: be-arch
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-07T06:05:29.429Z", actor: "cli/feature-prioritise" }
---

# Feature: be-arch-8-deprecated-shim-sunset

## Summary

Sweep the accumulated deprecated shims and bring the architecture docs back in sync with the filesystem. The codebase carries several completed migrations whose compatibility layers were never sunset: **F616** left `/api/budget`, `/api/budget/refresh`, and `/api/quota` routes as "deprecated shims" alongside the unified `/api/agent-quota`, kept `lib/quota-poller.js` as a 16-line re-export, and kept `lib/budget-poller.js` at 888 lines when only its scrape primitives are still consumed by `agent-quota-poller.js`; **F342** deprecated `review-state.json` writers with a "synonym fallback during migration" that is still being honoured. Separately, `AGENTS.md`'s module map has drifted hard from reality: it documents `lib/dashboard.js`, `lib/devserver.js`, and `lib/feature-review-state.js` — none of which exist on disk — and its line counts are off by 2–2.5× on the biggest modules (`dashboard-status-collector.js` documented ~900, actual 2,211; `feature-close.js` ~740 → 1,569; `feature-autonomous.js` ~830 → 1,531). For a repo whose primary developers are AI agents that *plan from these docs*, doc drift is an architecture defect, not a cosmetic one. This feature removes what the migrations' authors said should go, and adds a tiny mechanical freshness check so the map cannot silently rot again.

## User Stories

- [ ] As an implementing agent reading AGENTS.md, every module the map names exists, and the size/ownership description is close enough to reality to plan against.
- [ ] As a maintainer, the quota/budget surface is one endpoint, one poller, one state file — the F616 end-state — with no zombie routes for a UI that no longer calls them.
- [ ] As a reviewer, "deprecated during migration" markers in this codebase come with an expiry: this feature establishes the precedent by clearing the backlog of them.

## Acceptance Criteria

- [ ] **F616 sunset:** confirm the dashboard frontend and all CLI/tests call only `/api/agent-quota` (grep templates/dashboard + tests); then remove the `/api/budget`, `/api/budget/refresh`, `/api/quota` route entries from `lib/dashboard-routes/analytics.js`, delete `lib/quota-poller.js`, and reduce `lib/budget-poller.js` to the scrape primitives actually imported by `lib/agent-quota-poller.js` (move them into the agent-quota module family if that reads better; target: the 888-line file shrinks to the genuinely-live surface or disappears). The `aigon doctor --fix` migration for legacy `budget-cache.json`/`quota.json` state files stays (state migration ≠ API shim).
- [ ] **F342 fallback audit:** find the "review-complete sidecar accepted as synonym" fallback; determine from telemetry/repo state whether any live repo still produces it (check what writes it today — expected: nothing). If dead, remove the fallback and fail loudly per the write-path contract; if still produced somewhere, fix that producer and then remove. Document the finding either way — do not extend the migration window silently.
- [ ] **Facade audit:** for each documented-or-actual thin facade (`lib/constants.js` [23 lines], `lib/utils.js` re-export surface, worktree/telemetry facades created by be-arch-4/6 if landed): verify each re-export still has importers; delete dead re-exports. Remove tombstone references to `lib/dashboard.js`/`lib/devserver.js`/`lib/feature-review-state.js` from AGENTS.md (or re-point to their successors).
- [ ] **AGENTS.md module map refresh:** every row verified against disk — path exists, line count within ~20% (use the map's own advice: "Run `wc -l` for live counts" — consider dropping exact counts in favour of size-band words [small/medium/large/x-large] to reduce future rot; decide and apply consistently), ownership sentence still true. Stale F-notes corrected (e.g. collector row's ~900).
- [ ] **Freshness guard:** extend be-arch-1's `scripts/check-module-graph.js` (or a sibling ~40-line script in `test:core`) to parse module paths named in AGENTS.md's module-map table and fail when a named path does not exist on disk. (Path-existence only — no line-count enforcement; that would be noise.)
- [ ] Dashboard e2e + full `test:core` green; `aigon agent-quota` CLI and the budget widget verified working against the surviving endpoint (MCP `browser_snapshot` of the widget).
- [ ] CHANGELOG notes the removed endpoints (external users could conceivably script them; the dashboard is localhost-only but note it anyway).

## Validation

```bash
node scripts/check-module-graph.js
npm run test:iterate
```

## Technical Approach

- Order: grep-prove each shim unused → delete → test → next. Apply the verify-before-claiming rule in reverse: verify-unused-before-deleting; every deletion in the feature log carries its grep evidence (same discipline as dash-arch-9's dead-CSS audit).
- The budget-poller reduction depends on reading `agent-quota-poller.js`'s actual imports — keep exactly that surface, delete the rest (the F616 spec already declared this file "kept for scrape logic reused by agent-quota-poller"; this feature finishes the thought).
- Doc refresh last, after all code moves in this feature (and rebased over any landed be-arch siblings) so the map describes the end state.
- Restart the dashboard server after `lib/*.js` edits (hot rule #3).

## Dependencies

- None hard. Best sequenced **last** in the set so the AGENTS.md refresh captures the post-refactor shape (soft ordering, not a frontmatter dependency — it can run standalone if the set stalls).

## Out of Scope

- Any new quota/budget behaviour (F616's design is the fixed target).
- Sunsetting compatibility facades be-arch-2/4/6 deliberately create (those are new, with live importers — their removal is future mechanical work).
- Auto-generating the module map from code (tempting, but the map's value is its curated ownership prose; the existence check is the right-sized guard).
- README/site docs (AGENTS.md + docs/architecture.md only).

## Open Questions

- Does `docs/architecture.md` (709 lines) carry the same stale module list? Audit and fix in the same pass — it is reading-order item 2 for agents.
- Are there other "deprecated during migration" markers findable by grep (`deprecated`, `legacy`, `shim`, `synonym fallback`) that belong in this sweep? Inventory first, then include only those whose migration window is clearly closed — this feature must not become an unbounded cleanup.

## Related

- Prior work: F616 (agent-quota unification — the shims' origin and their declared end-state), F342 (review-state deprecation), F294 (the precedent for deleting half-states loudly rather than carrying them).
- Set: be-arch — the hygiene close-out; establishes that migrations in this codebase end with a sunset commit, not an indefinite compatibility tail.
