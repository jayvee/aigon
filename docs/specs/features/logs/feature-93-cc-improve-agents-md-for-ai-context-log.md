---
status: submitted
updated: 2026-03-18T01:25:59.899Z
startedAt: 2026-03-18T01:17:30.645Z
events:
  - { ts: "2026-03-18T01:17:30.645Z", status: implementing }
  - { ts: "2026-03-18T01:20:04.752Z", status: implementing }
  - { ts: "2026-03-18T01:22:51.705Z", status: waiting }
  - { ts: "2026-03-18T01:25:59.899Z", status: submitted }
---

# Implementation Log: Feature 93 - improve-agents-md-for-ai-context
Agent: cc

## Plan
- Update `docs/aigon-project.md` with 7 orientation sections (source of truth for AGENTS.md)
- Run `aigon install-agent cc` to regenerate AGENTS.md and CLAUDE.md
- Update `docs/architecture.md` module map with accurate line counts

## Progress
- Rewrote `docs/aigon-project.md` (88 lines): Quick Facts, ctx Pattern, Module Map, Where To Add Code, Five Rules Before Editing, Common Agent Mistakes, Reading Order
- Ran `aigon install-agent cc` → AGENTS.md regenerated at 97 lines (target: 80-100 ✓)
- Updated `docs/architecture.md`: corrected stale line counts (validation.js, proxy.js, dashboard-server.js), added missing git.js and state-machine.js entries
- All spec validation checks pass

## Decisions
- Edit `docs/aigon-project.md` (not AGENTS.md directly) — it's the committed source of truth; AGENTS.md is gitignored and regenerated
- Kept existing operational content (dashboard, testing, versioning) folded into Quick Facts rather than discarding it
- AGENTS.md title changed from "Claude Instructions for Aigon" to "Aigon — Codebase Orientation" — more accurate for a shared orientation file used by all agents
- Module map includes 12 key modules sorted by line count (largest first) for quick scanning
- ctx pattern example uses real `buildCtx()` from `lib/commands/shared.js` and real field names (`ctx.git.getCurrentBranch()`, `ctx.utils.PATHS`)
- All 4 feedback memory rules incorporated: no invented args, filter .env.local, screenshot dashboard, simplify = remove code
