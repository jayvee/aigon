# Implementation Log: Feature 570 - autonomous-controller-log-access
Agent: cx

## Status

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: cc (Opus)
**Date**: 2026-06-25

### Fixes Applied
- `536902064` fix(review): normalize both sides of entityId comparison in transcript lookup — the new `normalizeEntityId` helper was applied to only one side of two comparisons (`collectTranscriptRecords` normalized `raw.entityId` but compared against an un-normalized input `entityIdStr`; `findTelemetryForSession` normalized the input but compared against an un-normalized `record.featureId`). A padded id on the un-normalized side would silently fail to match, defeating the leading-zero handling the change was meant to add. Both comparisons now normalize both sides.

### Validation
- Validation not run by reviewer per policy.

### Escalated Issues (exceptions only)
- **ESCALATE:architectural** — Controller-log capture reuses the F430 opt-in tmux pipe-pane path (`attachSessionCapture` in `lib/worktree.js`), which only writes `tmuxLogPath` when `transcripts.tmux === true`. That flag is **off by default** (`DEFAULT_GLOBAL_CONFIG.transcripts.tmux: false`), so in the default configuration the `role: auto` session never gets a captured log and the new UI always renders the "Controller log is not available" state. This is precisely the gated pre-audit the spec flagged ("determine whether `role: auto` tmux sessions are captured durably enough … if not, the scope splits into (a) extending capture/retention for `role: auto` and (b) the dashboard log-view surface — resolve before writing the UI"). Reusing F430 is in the spirit of "reuse existing surfaces," but whether controller capture should be forced on for `role: auto` regardless of the privacy-gated `transcripts.tmux` flag is an architectural/retention decision I did not make unilaterally — the config comment marks it a deliberate machine-level privacy/security gate. Decide: (a) accept that controller logs require operators to opt into `transcripts.tmux` (then document it as the by-design unavailable state), or (b) always-capture `role: auto` controller output independent of the opt-in flag.

### Notes
- The implementation log was committed as an empty skeleton — every section is blank, so the gated pre-audit decision (the central design question of this feature per the spec) is undocumented. Please fill in Status / Key Decisions, and in particular record the capture-gating decision above.
- API surface, route safety (paths sourced only from sidecars; `repoPath` validated via `resolveRequestedRepoPathOrRespond`; tail-read with a 256 KB cap and `truncated` flag), and the available/missing test coverage all look sound and consistent with the existing transcript routes.
- The `agent: null` → `agent: 'auto'` change in `feature-autonomous.js` is the correct producer-side wiring: `collectTranscriptRecords(..., 'auto')` filters sidecars on `raw.agent === 'auto'`, so without it the controller session would never be found.
