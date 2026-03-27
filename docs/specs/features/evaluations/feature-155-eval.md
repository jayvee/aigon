# Evaluation: Feature 155 - pipeline-card-layout-redesign

**Mode:** Fleet (Multi-agent comparison)

## Spec
See: `./docs/specs/features/04-in-evaluation/feature-155-pipeline-card-layout-redesign.md`

## Implementations to Compare

- [x] **cc** (Claude): `/Users/jviner/src/aigon-worktrees/feature-155-cc-pipeline-card-layout-redesign`
- [x] **cx** (Codex): `/Users/jviner/src/aigon-worktrees/feature-155-cx-pipeline-card-layout-redesign`
- [x] **gg** (Gemini): `/Users/jviner/src/aigon-worktrees/feature-155-gg-pipeline-card-layout-redesign`

## Evaluation Criteria

| Criteria | cc | cx | gg |
|----------|---|---|---|
| Code Quality | 8/10 | 7/10 | 0/10 |
| Spec Compliance | 8/10 | 7/10 | 0/10 |
| Performance | 9/10 | 8/10 | 0/10 |
| Maintainability | 8/10 | 8/10 | 0/10 |
| **Total** | **33/40** | **30/40** | **0/40** |

## Summary

| Agent | Lines | Score |
|---|---|---|
| cc | 72+ / 18- | 33/40 |
| cx | 93+ / 32- | 30/40 |
| gg | 8+ (log only) | 0/40 |

### Strengths & Weaknesses

#### cc (Claude)
- Strengths:
  - Complete implementation of Option D (hybrid: 2-char short names + stacked status)
  - Clean refactor: `buildAgentStatusHtml` returns data object, new `buildAgentStatusSpan` wrapper preserves monitor view backward compatibility
  - Globe always visible via `margin-left: auto` on agent name row
  - Flag buttons shortened ("Submit", "Re-open", "View") with compact `.kcard-flag-btn` CSS
  - Added missing `status-flagged` color (orange) for unconfirmed state
  - Full agent name available via tooltip on hover — good UX trade-off
  - Monitor view updated (`index.html`) to use new `buildAgentStatusSpan`
- Weaknesses:
  - `buildAgentStatusHtml` name is misleading (now returns data, not HTML)
  - No Playwright screenshot included

#### cx (Codex)
- Strengths:
  - Complete implementation of Option B (stacked layout with full agent names)
  - Smart overflow consolidation: moves "Re-open Agent" and "View Work" into overflow menu, keeping only "Mark Submitted" as primary — good clutter reduction
  - Added status-based background tints (`agent-state-running`, `agent-state-submitted`, etc.) for visual distinction between agent states — addresses spec problem #5
  - New `buildAgentHeaderHtml` and `getAgentStateClass` helpers are well-factored
  - Removed `text-overflow: ellipsis` and `white-space: nowrap` from status — status now wraps instead of truncating
  - Well-documented log with clear rationale
- Weaknesses:
  - **Bug: Monitor view loses dev server globe links.** `buildAgentStatusHtml` no longer accepts `options` or renders dev links, but `index.html` still calls it with `{ showDevLink: true }` in 3 places. The extra arg is silently ignored — monitor table rows lose their globe links.
  - Modified the spec file directly (checked acceptance criteria, changed open questions) — agents shouldn't edit the spec during implementation
  - Full agent names still risk width issues at ~180px card width (e.g., "Claude Code" = 11 chars + globe, but now on its own row so less critical)

#### gg (Gemini)
- Strengths: None — no implementation produced
- Weaknesses: Only created an empty log template. Zero code changes.

## Recommendation

**Winner:** cc

**Rationale:** Both cc and cx produced working implementations with different design choices (Option D vs Option B). CC wins on completeness and correctness: it updated the monitor view for backward compatibility, while CX has a bug that breaks dev server globe links in the monitor table. CC's short name approach (CC, GG, CX with tooltip) is also a better fit for the ~180-220px card width constraint.

Before merging, consider adopting from cx: the **status-based background tints** (`agent-state-running`, `agent-state-submitted`, etc.) are a nice visual distinction that CC's implementation lacks. Also consider cx's **overflow menu approach for flag buttons** (moving "Re-open" and "View Work" into overflow) — it's a cleaner solution for button clutter than just shortening labels.
