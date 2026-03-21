---
status: waiting
updated: 2026-03-15T22:41:56.798Z
startedAt: 2026-03-05T10:12:57+11:00
completedAt: 2026-03-05T10:14:09+11:00
autonomyRatio: 0.00
---

# Implementation Log: Feature 06 - website-modes-structure-and-communication-refresh

## Plan
- Refresh homepage information architecture to a mode-first narrative:
  problem -> value proposition -> modes grid -> terminal examples by mode -> loop/workflow -> docs CTA.
- Remove legacy terms from active website/docs content and align all examples to Drive/Fleet/Autopilot/Swarm.
- Add a lightweight automated content test to prevent terminology regressions.

## Progress
- Reworked homepage navigation and section structure in `index.html`:
  - Added dedicated `#modes` section with explicit 2x2 framing.
  - Added per-mode cards with purpose/when-to-use/example/outcome.
  - Converted terminal demo tabs to Drive/Fleet/Autopilot/Swarm examples.
- Updated docs terminology:
  - `docs/development_workflow.md`
  - `docs/agents/{claude,codex,gemini,cursor}.md`
- Added `scripts/test-modes-content.sh`:
  - Checks required mode terms/sections/examples.
  - Fails on legacy terms in active pages/docs.
  - Validates homepage section order and Swarm command correctness.
- Corrected prompt style in autonomous demos based on review:
  - Autopilot and Swarm tabs now use bash-style prompt (`$ `).
- Corrected Swarm command flow after CLI behavior review:
  - Removed invalid `feature-setup ... --autonomous` examples.
  - Updated to Fleet setup + autonomous implement per worktree (`--auto-submit`).

## Decisions
- Use canonical mode names as primary labels everywhere:
  `Drive`, `Fleet`, `Autopilot`, `Swarm`.
- Keep legacy names out of active content entirely (no mixed active labels).
- Represent Swarm as a sequence, not a single setup flag, because current CLI behavior requires:
  1) `feature-setup <ID> <agents...>`
  2) `feature-implement <ID> --autonomous --auto-submit` in each worktree.
- Keep homepage examples operationally realistic (CLI-first for autonomous usage).

## Conversation Summary
- User requested fast-tracked implementation of the mode communication refresh.
- User reviewed terminal examples and requested bash-style prompts for autonomous demos.
- User flagged Swarm command accuracy; this triggered a direct CLI/docs verification pass against `~/src/aigon`.
- Final implementation now reflects validated command flow and consistent terminology across homepage + docs.
