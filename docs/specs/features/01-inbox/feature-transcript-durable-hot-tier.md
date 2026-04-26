---
complexity: high
set: transcript-program
---

# Feature: transcript-durable-hot-tier

## Summary
Copy the live native transcript body into a machine-global durable hot tier at finalisation moments (`feature-close`, `agent quarantine`) so transcripts survive worktree deletion and native log rotation. Write a `.meta.json` sibling that joins the existing telemetry record. Extend `migrateEntityWorkflowIdSync` to atomically rename slug→numeric directories at the same moment workflow keys re-key. Second step in the research-43 transcript program — turns the fragile pointer layer into a durable artifact.

## User Stories
- [ ] As an operator investigating a feature shipped 60 days ago, the transcript is still on disk even though the worktree and native log are long gone.
- [ ] As a future analytics consumer, I can list transcripts under `~/.aigon/transcripts/<repo>/<entityType>/<entityId>/<agent>/` and join them with telemetry without re-running anything.
- [ ] As a quarantine flow, when `aigon agent quarantine <id> <model>` fires, all active sessions for that agent get snapshotted under `~/.aigon/transcripts/<repo>/quarantine/<ts>-<model>/` so we have audit evidence.

## Acceptance Criteria
- [ ] Storage layout: `~/.aigon/transcripts/<repo>/<entityType>/<entityId>/<agent>/<role>-<sessionUuid>.{jsonl,meta.json}`. Machine-global (not under any repo's `.aigon/state/`).
- [ ] At `feature-close` finalisation, every captured session for the feature gets its native body copied (file copy, not move; native log keeps existing) and a `.meta.json` written joining the telemetry record.
- [ ] At `agent quarantine`, snapshot active sessions under `quarantine/<timestamp>-<model>/` keyed identically.
- [ ] `.meta.json` schema: `schemaVersion`, `telemetryRef`, `sessionName`, `tmuxId`, `agentSessionId`, `nativeBodyBytes`, `complete`, `finalisedAt`, `finalisedBy`. Strict superset of telemetry — no parser duplication.
- [ ] `migrateEntityWorkflowIdSync` extended to rename `<slug>/` → `<numericId>/` directory under `~/.aigon/transcripts/<repo>/<entityType>/` if it exists at prioritise time. Atomic with the workflow re-key.
- [ ] No native body is ever moved or deleted from the agent's home directory; we only ever copy.
- [ ] Read path in `transcript-read-model-and-cli` updated to prefer the durable copy when present, fall back to live `agentSessionPath` when not.
- [ ] Test coverage with `// REGRESSION:` comments for: feature-close → file copied; quarantine → snapshot directory created; prioritise → slug directory renamed.

## Pre-authorised

## Technical Approach
- Hook into `lib/feature-close.js` finalisation phases (after merge, before cleanup). Iterate captured sessions via `readLatestSidecarWithSession` per agent + role.
- Copy native bodies with `fs.copyFileSync`; write `.meta.json` atomically (use existing `safeWrite` helper).
- Slug→numeric rename: extend `migrateEntityWorkflowIdSync` in `lib/workflow-core/`. `fs.renameSync` (atomic on same filesystem); on rare collision, append `.collision-<sha>` suffix and log.
- Quarantine hook: at F358 quarantine fire-point, walk active tmux sessions for the agent (via `lib/session-sidecar.js`) and copy current body state.
- New module `lib/transcript-store.js` for path resolution and write helpers; consumed by feature-close, quarantine, and the read-model collector.

## Dependencies
- depends_on: transcript-read-model-and-cli

## Out of Scope
- `tmux pipe-pane` raw capture (separate feature).
- Cold tier upload to S3/R2/GCS.
- Redaction (happens at export time, not capture; lands with cold tier or CLI export).
- Retention policy / GC of old hot-tier files — defer; decide after 90 days of usage data.

## Open Questions
- Should we also copy at `feature-reset` (destructive)? Likely yes — reset is the other point where the worktree disappears.
- For a session still alive at `feature-close` (Fleet, mid-flight agent), copy the current state; a second pass at the next finalisation will overwrite with the longer body.
- For Gemini's single-JSON-blob format, is a mid-session snapshot safe? Verify during implementation.

## Related
- Research: 43 — session-transcript-capture-and-storage
- Set: transcript-program
- Prior features in set: transcript-read-model-and-cli
