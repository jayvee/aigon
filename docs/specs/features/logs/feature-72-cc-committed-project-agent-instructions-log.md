---
status: submitted
updated: 2026-03-16T13:23:49.458Z
startedAt: 2026-03-16T13:05:13.203Z
completedAt: 2026-03-16T13:23:49.458Z
events:
  - { ts: "2026-03-16T13:05:13.203Z", status: implementing }
  - { ts: "2026-03-16T13:06:33.458Z", status: implementing }
  - { ts: "2026-03-16T13:09:29.689Z", status: waiting }
  - { ts: "2026-03-16T13:23:26.164Z", status: submitted }
---

# Implementation Log: Feature 72 - committed-project-agent-instructions
Agent: cc

## Plan

Add `upsertRootFile()` and `getProjectInstructions()` helpers to `lib/utils.js`, then wire them into `install-agent` and `syncAgentsMdFile` to replace the two-branch new/existing file logic. Create `docs/aigon-project.md` for the Aigon repo.

## Progress

- Added `upsertRootFile(filePath, preMarkerContent, markerContent)` — atomically replaces both the pre-marker zone and the marker block, handling create/update/unchanged/appended cases
- Added `getProjectInstructions()` — reads `docs/aigon-project.md` from cwd if present, falls back to scaffold
- Exported both functions
- Simplified `syncAgentsMdFile()` from two-branch logic to single `upsertRootFile()` call
- Simplified `install-agent` rootFile handling from two-branch logic to single `upsertRootFile()` call
- Added `upsertRootFile` and `getProjectInstructions` to the destructuring in `shared.js`
- Created `docs/aigon-project.md` with dashboard, testing, template sync, and versioning instructions

## Decisions

- `upsertRootFile` uses a regex that matches from start-of-file through `AIGON_END` so re-runs fully replace the pre-marker zone with no accumulation
- No auto-creation of `docs/aigon-project.md` if missing — user opt-in only, falls back to scaffold
- The user questioned the usefulness of the feature during review; it was clarified that the file is per-repo — each target project creates its own, and the Aigon repo's copy is just dog-fooding the mechanism
