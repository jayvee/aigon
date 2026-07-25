# Evaluation: Feature 123 - aade-telemetry

**Mode:** Fleet (Multi-agent comparison)
**Evaluator:** cc (anthropic) — same-family bias noted for cc scoring

## Spec
See: `./docs/specs/features/04-in-evaluation/feature-123-aade-telemetry.md`

## Implementations to Compare

- [x] **cc** (Claude): `/Users/jviner/src/aigon-worktrees/feature-123-cc-aade-telemetry`
- [x] **cx** (Codex): `/Users/jviner/src/aigon-worktrees/feature-123-cx-aade-telemetry`

## Evaluation Criteria

| Criteria | cc | cx |
|---|---|---|
| Code Quality | 8/10 | 7/10 |
| Spec Compliance | 7/10 | 9/10 |
| Performance | 8/10 | 7/10 |
| Maintainability | 9/10 | 6/10 |
| **Total** | **32/40** | **29/40** |

## Summary

| Agent | Lines | Score |
|---|---|---|
| cc | 648 | 32/40 |
| cx | 440 | 29/40 |

### Strengths & Weaknesses

#### cc (Claude)
- Strengths:
  - Clean module separation: dedicated `lib/telemetry.js` (242 lines) with well-defined exports follows the existing `lib/*.js` module map pattern
  - Comprehensive pricing table with exact model IDs, cache token rate constants, and prefix-match fallback for version-suffixed models
  - 17 dedicated unit tests in `lib/telemetry.test.js` — isolated, repeatable, no side effects on the main test suite
  - `captureFeatureTelemetry()` cleanly integrates into feature-close with a single call, passing `linesChanged` for the derived ratio
  - Dashboard cards filter by period/repo context (uses `filteredFeatures`), not global totals
- Weaknesses:
  - **Spec deviation**: captures telemetry at feature-close only (batch), not via SessionEnd hook as spec requires — misses incremental capture during implementation
  - Does not track `thinking_tokens` separately (lumps into output or ignores)
  - No session deduplication mechanism — if feature-close runs twice, transcripts could be double-counted
  - No `aigon insights` help text update

#### cx (Codex)
- Strengths:
  - **Follows the spec exactly**: implements a SessionEnd hook (`capture-session-telemetry` in `cc.json`) for incremental, per-session telemetry capture
  - Session deduplication via `telemetry_session_ids` — prevents double-counting on hook re-runs
  - Tracks `thinking_tokens` as a separate field
  - Computes `tokens_per_line_changed` at feature-close when git signals are written — correct two-phase approach (accumulate tokens incrementally, derive ratio at close)
  - Updates `templates/help.txt` to reflect Pro requirement for insights
  - Dashboard shows both free AADE cards and a clear "AADE Pro" teaser section with labeled feature badges
  - Tests integrated into the main `aigon-cli.test.js` suite with `_test` exports
- Weaknesses:
  - All telemetry logic (180+ lines) stuffed into `lib/commands/misc.js` — violates the Module Map pattern where shared logic belongs in `lib/*.js`
  - Duplicates frontmatter parsing logic (`upsertFrontmatterScalars`) instead of using the existing `upsertLogFrontmatterScalars` from utils
  - `readSessionEndPayloadFromStdin()` uses synchronous `fs.readFileSync(0)` which can block if stdin isn't ready
  - Pricing rates stored as per-million values (e.g., `input: 3`) instead of per-token — less explicit, requires the `/1_000_000` division elsewhere
  - Dashboard AADE section renders unconditionally (even with zero data) with "0" and "$0.00" cards, which adds visual noise for users who haven't used telemetry yet
  - `extractFeatureContextFromBranch` pads feature numbers with `padStart(2, '0')` which would break for 3-digit features like 123 (becomes "123" anyway, but the intent signals a 2-digit assumption)


## Recommendation

**Winner:** cc

**Rationale:** CC produces cleaner, more maintainable code by creating a proper `lib/telemetry.js` module with isolated tests — following the project's established architecture. While CX more faithfully implements the spec's SessionEnd hook approach (which is genuinely the better design), its implementation suffers from poor code placement (180 lines in misc.js), duplicated utility functions, and a fragile stdin-reading pattern.

**Cross-pollination:** Before merging cc, consider adopting from cx:
1. **SessionEnd hook wiring** (`templates/agents/cc.json` SessionEnd entry + `capture-session-telemetry` command) — this is the spec-intended design and captures telemetry incrementally rather than only at feature-close. The cc telemetry module's `parseTranscriptFile` and `captureFeatureTelemetry` functions could back this command.
2. **Session deduplication** (`telemetry_session_ids` field) — prevents double-counting if the hook fires multiple times for the same transcript.
3. **`thinking_tokens` tracking** — cx captures this separately which is useful for cost analysis.
4. **`templates/help.txt` update** — small but correct; reflects Pro requirement for insights.

