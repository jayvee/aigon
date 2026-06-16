# Implementation Log: Feature 551 - doctor-collapse-sections
Agent: cc

## Status
Implemented `withSection` buffer wrapper in `doctor` command; healthy sections collapse to `✅ <Title> — <summary>`, warn/fail expand fully; `--full` restores legacy output. Port Health and Agent install paths are verbose-only.

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: cu
**Date**: 2026-06-12

### Fixes Applied
- `3dc903f3` fix(review): collapse state reconciliation and fix section summaries

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- **ESCALATE:ambiguous** — Multi-Repo expanded view still lists all repos when any are behind; spec suggests collapsing current rows to a `…N current` line "where practical". Not patched here — needs a product call on how aggressive partial collapse should be.
- **ESCALATE:architectural** — Open question in spec: merge trivial healthy sections (Dashboard, Backup, git identity, Proxy) onto one "Environment" line. Left as one-per-line per current implementation.

### Notes
- Core `withSection` collapse, `--full`, and verbose-only Port Health / Agent install paths look correct.
- State Reconciliation was the main gap: it always printed its full body even when healthy because legacy `issues[]` were mirrored to `DoctorReport` only after the section finished. Review added `expandWhen` and wrapped the block.
- `report.pass(id, title, summaryLine)` is still unused; sections return summary strings from their printers instead. Behaviour matches spec; wiring `pass()` would be cosmetic consistency only.
