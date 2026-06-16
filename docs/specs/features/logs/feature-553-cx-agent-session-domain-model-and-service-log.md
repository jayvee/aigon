# Implementation Log: Feature 553 - agent-session-domain-model-and-service
Agent: cx

## Status

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: cc
**Date**: 2026-06-17

### Fixes Applied
- `3dfa42d3` fix(review): keep agent-session store backwards-compatible with live sidecars
  - `store.listSessions()` mapped `normalizeAgentSessionRecord` over every
    `.aigon/sessions/*.json` file with no per-record guard. Live sidecars include
    set-conductor records (`entityType: 'S'`, 5 present on disk in the main repo)
    and agent-less `auto` conductor records (`agent: null`) — both written by
    `writeSessionSidecarRecord` (worktree.js) / `set-conductor.js`. The strict
    normalizer throws `Invalid entity type` / `Missing agent id` on these, so a
    single such file threw the entire listing. Now skipped per-record, matching
    the existing `loadSessionSidecarIndex` tolerance. `readSession`/`getSession`
    keep their strict single-record behavior.
  - `toSidecarShape()` persisted `agent` as the model object `{ id }`. Existing
    readers require a bare string: `session-sidecar.js` `readLatestSidecarWithSession`
    does `raw.agent !== agentId` (F351/F357 transcript resume) and `worktree.js`
    does `String(side.agent)` → `"[object Object]"`. Both silently break. Now
    writes the string id and round-trips `slotAgentId`/`runtimeAgentId` via
    top-level siblings that `normalizeAgent` reads back (model.js).

### Validation
- Validation not run by reviewer per policy.

### Escalated Issues (exceptions only)
- ESCALATE:ambiguous — The model intentionally requires an `agent.id` and maps
  only `feature`/`research` entity types, so it cannot represent two real session
  kinds that exist on disk today: agent-less `auto` conductor sessions and
  set-autonomous `'S'` sessions. For this contract-only feature that is acceptable
  (no production consumer; `listSessions` now skips them). But before a future
  feature lets `AgentSessionStore` replace `loadSessionSidecarIndex`, the domain
  must decide whether to model these (optional agent + a third category/entity
  type) or explicitly exclude them. This is a design decision the spec deferred
  (Open Questions kept the model minimal), not a safe in-pass patch.

### Notes
- Acyclic boundary verified: `lib/agent-sessions/` imports only `fs`, `path`,
  internal siblings, and `lib/io/json.js` — no worktree/dashboard/workflow-core/
  commands edges. Covered by the in-suite boundary test.
- The implementation log skeleton (Status / New API Surface / Key Decisions / etc.)
  was left empty by the implementer. Not a code issue, but worth filling before close
  for the audit trail.
