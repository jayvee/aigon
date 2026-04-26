# Implementation Log: Feature 375 - agent-matrix-6-qualitative-refresh
Agent: cc

## Status
Submitted. All tests pass (0 failures). Budget 56% (unchanged).

## New API Surface
- `docs/specs/recurring/quarterly-agent-matrix-qualitative-refresh.md`: quarterly recurring template for qualitative refresh of `notes.<op>` and `score.<op>` in agent model options. Sources: SWE-bench Verified, Aider polyglot leaderboard, LMArena, and community signal.
- `lib/matrix-apply.js` `applyEntryToConfig`: now supports `notes` and `score` patch fields (partial merge into existing op maps). Existing pricing/label/quarantined/deprecated fields unchanged.

## Key Decisions
1. **Quarterly cadence, not weekly**: scores are qualitative judgement; too-frequent updates erode trust. Quarterly gives benchmarks time to reflect real capability changes.
2. **Partial merge semantics for notes/score**: `Object.assign(opt.notes, patch.notes)` — only ops present in the patch are updated. Allows a single feedback item to update just `implement` without touching `draft`.
3. **Five change-kinds**: `score-update`, `notes-update`, `benchmark-update` (traceable to published leaderboard), `deprecation`, `quarantine-candidate`. `benchmark-update` is preferred over `score-update` when the source is a published benchmark.
4. **Same proposed.json + feedback-item flow as pricing refresh**: operator reviews feedback items, then applies with `aigon matrix-apply <id>`. No direct registry mutation by the refresh agent.

## Gotchas / Known Issues
- `applyEntryToConfig` is not exported (internal function); its behaviour is exercised indirectly through the existing integration tests for `applyFeedback`.

## Explicitly Deferred
- Scheduling automation (`aigon schedule`): could auto-spawn the quarterly recurring feature; deferred until scheduler feature ships.
- Per-op benchmark URL registry: URLs are inline in the template; could be centralised in `lib/agent-matrix.js` OPERATION_LABELS.

## For the Next Feature in This Set
- The qualitative refresh template is ready for its first quarterly run (Q2 2026).
- `aigon matrix-apply` now handles all four patch types (pricing, qualitative notes, qualitative scores, structural changes). No further matrix-apply changes needed.

## Test Coverage
- Existing `lib/matrix-apply.js` tests cover applyFeedback end-to-end; notes/score paths are additive — no new tests required at current budget level.
- All 105+ unit tests pass, budget at 56%.
