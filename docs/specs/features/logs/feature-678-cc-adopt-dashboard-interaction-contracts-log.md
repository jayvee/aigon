---
commit_count: 12
lines_added: 715
lines_removed: 60
lines_changed: 775
files_touched: 17
fix_commit_count: 5
fix_commit_ratio: 0.417
rework_thrashing: true
rework_fix_cascade: false
rework_scope_creep: true
input_tokens: 706
output_tokens: 239004
cache_creation_input_tokens: 741617
cache_read_input_tokens: 59529213
thinking_tokens: 0
total_tokens: 60510540
billable_tokens: 239710
cost_usd: 40.6997
sessions: 2
model: "claude-fable-5"
tokens_per_line_changed: null
---
# Implementation Log: Feature 678 - adopt-dashboard-interaction-contracts
Agent: cc

## Status
Contracts adopted for every interactive feature/research/set card (done rows stay lean per F459/F469/F590); found and fixed two latent producer defects — duplicate `PAUSE_FEATURE` candidates the browser had been silently deduping, and a missing `currentSpecState` that left `contract.state.lifecycle` null. Contract/fingerprint/cutover details live in `docs/feature-interaction-contract.md`; ceiling raised 15737→16000 (approved).

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: cu
**Date**: 2026-07-15

### Fixes Applied
- `504b9c24e` fix(review): project lifecycle for snapshotless inbox/backlog cards

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- None

### Notes
- Implementation cleanly wires research/set contracts through the collector, extends fingerprints, and catches the duplicate PAUSE_FEATURE producer defect with parity tests. Review fixes were limited to snapshotless pre-start lifecycle projection (feature fallback + research paths) and removing erroneous self-referential set membership on feature-set entities.
