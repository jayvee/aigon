---
status: submitted
updated: 2026-03-17T14:40:54.973Z
startedAt: 2026-03-17T14:25:25.516Z
events:
  - { ts: "2026-03-17T14:25:25.516Z", status: implementing }
  - { ts: "2026-03-17T14:26:01.242Z", status: implementing }
  - { ts: "2026-03-17T14:39:57.196Z", status: waiting }
  - { ts: "2026-03-17T14:40:54.973Z", status: submitted }
---

# Implementation Log: Feature 83 - remove-radar-dead-code

## Plan

1. Audit all radar references across lib/, templates/, tests, and docs
2. Classify each reference as dead code (remove) or live-but-misnamed (rename)
3. Remove dead functions, constants, command, and re-exports
4. Rename live functions from Radar→Dashboard
5. Update all tests
6. Rewrite stale docs (README, GUIDE, dashboard.md, help.txt)

## Summary

Removed all radar dead code from the codebase. Radar was the predecessor to the dashboard — it had been deprecated but ~30 references remained across code, tests, and docs.

## Changes

- Removed `aigon radar` command (was just a deprecation warning)
- Removed `detectRadarContext()` — unused dead function
- Removed `RADAR_DEFAULT_PORT`, `RADAR_DYNAMIC_PORT_START` — just aliases for dashboard constants
- Renamed 5 live functions from `*Radar*` to `*Dashboard*` (action API used by dashboard UI)
- Removed 8 dead re-exports from `lib/dashboard.js` (functions that no longer exist in utils.js)
- Updated all 11 affected tests to use new names, removed 1 duplicate test
- Rewrote `docs/dashboard.md` — was completely stale (said radar was current, dashboard deprecated)
- Updated README.md, GUIDE.md, templates/help.txt — all radar sections renamed to dashboard
- Updated memory file to remove radar references

## Decisions

- Historical specs and logs in `05-done/`, `05-paused/`, `logs/selected/` were NOT modified — they're historical records
- The `conductor` command was left as-is — it's active code, just needs documentation (separate concern)
- Net -144 lines
