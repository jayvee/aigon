---
commit_count: 6
lines_added: 250
lines_removed: 405
lines_changed: 655
files_touched: 9
fix_commit_count: 3
fix_commit_ratio: 0.5
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 1943987
output_tokens: 12247
cache_creation_input_tokens: 0
cache_read_input_tokens: 1849600
thinking_tokens: 3647
total_tokens: 1956234
billable_tokens: 1959881
cost_usd: 4.3559
sessions: 1
model: "openai-codex"
tokens_per_line_changed: null
---
# Implementation Log: Feature 657 - dynamic-context-tiering
Agent: cx

> Sections below completed post-close by cc (2026-07-18) to resolve the reviewer's
> revision request — the implementer (cx) closed without authoring them. Content is
> reconstructed from the merge diff (`3198e215f`), review notes, and live guard output.

## Status

Complete and merged. `AGENTS.md` slimmed from the 75 KB maintainer orientation doc to an always-loaded invariants-and-pointers file; deep reference moved to `docs/architecture.md` / `docs/testing.md`; regression guard wired into `test:core` and `prepublishOnly`.

### Measurement (spec § Measurement)

- **Before:** `AGENTS.md` = 75,573 bytes / 439 lines. **After:** 7,366 bytes / 113 lines — a **90.3% byte reduction** (target ≥65%), with all 8 required safety anchors present (`scripts/check-root-instruction-budget.js` output: "113 lines, 7366 bytes, 8 safety anchors").
- **Paid first-turn token measurement: deliberately skipped**, as the spec permits when documented. Rationale: OpenCode injects the project-root `AGENTS.md` verbatim as a system-instruction source, so first-turn input reduction tracks the byte reduction directly; the remaining first-turn cost (harness prompt + tool schemas) is outside this feature's control, and spending paid OpenRouter credits on a measurement-only session would contradict the feature's cost-reduction purpose. The deterministic byte-budget evidence above is retained as the guard-enforced baseline. Baseline for reference: pre-feature OpenCode first turns observed at ~30–37k input tokens (spec Background).

## New API Surface

- `scripts/check-root-instruction-budget.js` — static guard: fails when `AGENTS.md` exceeds 24 KB or 180 lines, or when any required safety-anchor marker is missing. Wired into `test:core` and `prepublishOnly`.

## Key Decisions

- Static editorial split only — no dynamic tiers, marker extraction, task mapping, generated context files, or OpenCode config overrides, per the 2026-07-18 spec review (an `agent.build.prompt` override is additive and would not suppress the root file).
- Anchor check matches stable marker comments, not prose snapshots, so routine wording edits don't break the guard.
- `check-test-budget.sh` ceiling raised 16000 → 17225 (exact current LOC, not inflated) under the spec's `F657_PREAUTH` gate.

## Gotchas / Known Issues

- `CLAUDE.md` initially still described `AGENTS.md` as the single source of truth for the module map; fixed in review (`b5dcabdaa`).
- The old 12-step `currentSpecState` site-touch checklist was dropped from `AGENTS.md` without a home; restored post-review as the 10-step "Adding a lifecycle state" section in `docs/architecture.md` (`9d8040d48`).

## Explicitly Deferred

- Any OpenCode launch-path changes (title-agent disable, `OPENCODE_CONFIG_CONTENT`) — deliberately out of scope; title-agent calls bill at $0 BYOK.
- Rendered-template leak guard — separated into F683 at spec review (since shipped).

## For the Next Feature in This Set

- Not part of a set. Related follow-up F683 (rendered-agent-template-zero-opinion-guard) is done.

## Test Coverage

- `tests/unit/root-instruction-budget.test.js` — over-budget bytes/lines fail, missing anchors fail with actionable messages, clean state passes. Picked up by the `test:unit` glob; guard itself also runs directly in `test:core` and `prepublishOnly`.

## Code Review

**Reviewed by**: cc
**Date**: 2026-07-18

### Fixes Applied
- `b5dcabdaa` fix(review): correct CLAUDE.md pointer to reflect AGENTS.md slim-down — CLAUDE.md still claimed AGENTS.md was "the single source of truth for … the module map, state architecture"; this feature moved that detail to `docs/architecture.md`, so the pointer now over-promised. Reworded to point deep reference at `docs/architecture.md` / `docs/testing.md`.

### Validation
- Validation not run by reviewer per policy.

### Escalated Issues (exceptions only)
- None.

### Notes
- **Core deliverable is clean.** AGENTS.md slimmed 75,573 → 7,366 bytes (~90% reduction, far past the 65% target) and 439 → 113 lines. All 8 required safety anchors present. `scripts/check-root-instruction-budget.js` is correct (24 KB / 180-line budgets, anchor-presence check) and wired into `test:core` and `prepublishOnly`. Unit test `tests/unit/root-instruction-budget.test.js` is correct and picked up by the `test:unit` glob. Test-budget ceiling raised 16000 → 17225 = exact current LOC (not inflated), with matching `F657_PREAUTH` gate. No `templates/` changes; `project-context.js` untouched. De-duplication is sound — the module map and install-manifest detail already live in `docs/architecture.md`.
- **REVISION NEEDED — implementation log is empty.** Every section (Status, Key Decisions, Test Coverage, etc.) is blank, and the spec's **Measurement** acceptance criteria are wholly unmet: record before/after `AGENTS.md` lines/bytes (75,573→7,366 B, 439→113 lines), and either a before/after first-turn token observation for one Aigon-managed OpenCode session **or** a documented reason for skipping the paid measurement (retaining the byte-budget evidence). This is the implementer's to author — the reviewer cannot run the paid measurement or author the implementer's narrative. This is the reason for `--request-revision`.
- **Minor doc-completeness (implementer's call, not blocking):** the old AGENTS.md "Adding a `currentSpecState`" 12-step site-touch checklist was dropped without a home. `docs/architecture.md` § Workflow State documents the authority model thoroughly (the substance), but not that numbered "touch every site" procedure. Consider porting it into architecture.md's Workflow State section so the half-state-prevention discipline survives.
