---
complexity: medium
set: competitive-positioning
depends_on:
  [399]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-27T00:58:38.400Z", actor: "cli/feature-prioritise" }
---

# Feature: recurring-competitive-refresh

## Summary
Add a monthly recurring template under `docs/specs/recurring/` that scans GitHub releases, vendor blogs, Hacker News, and Reddit for movements in the agent-orchestration / spec-driven / multi-agent harness space. Output is a draft patch under `docs/competitive/scans/{YYYY-MM}.md` plus proposed cell flips on `docs/competitive/matrix.md` — never auto-merged. Idempotent: when nothing material moved, the spec writes "no material changes" and closes itself.

## User Stories
- [ ] As a maintainer, every ~30 days a new feature appears on the board with a draft matrix patch and a "what's new this month" summary — I review and merge the parts that hold up.
- [ ] As a researcher, I can read a dated changelog of how the landscape moved without redoing the scan.
- [ ] As a user reading the public comparison page, the matrix stays current because the scan flags acquisitions, shutdowns, and net-new entrants the maintainer might otherwise miss.

## Acceptance Criteria
- [ ] Recurring template exists at `docs/specs/recurring/competitive-refresh.md` and is picked up by `lib/recurring.js` at server start.
- [ ] When fired, the spec briefs the agent to scan: GitHub releases for tracked tools (`docs/competitive/entries/` directory listing as the source), vendor blogs/changelogs, HN top-monthly with keyword filter (`agent`, `coding`, `claude code`, `codex`, `multi-agent`, `worktree`, `spec-driven`), Reddit r/LocalLLaMA + r/ChatGPTCoding top-monthly.
- [ ] Output is a single file `docs/competitive/scans/{YYYY-MM}.md` with sections: New Tools, Changed Tools, Stale Tools, Benchmark Updates, Proposed Matrix Patch.
- [ ] Idempotent: when no material change is detected, the spec writes "no material changes; matrix unchanged" and closes itself in one autopilot cycle.
- [ ] Tracked-tool list is derived from `docs/competitive/entries/` — extending the matrix automatically extends the scan; no duplicate list in the recurring template.
- [ ] Output is capped at 2,000 words; the agent must summarize, not paste raw blog excerpts.

## Pre-authorised
- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Technical Approach
- Reuse the existing recurring engine (`lib/recurring.js`) and `WebSearch` / `WebFetch` tooling — no new infrastructure.
- The recurring engine creates 8 weekly types per `project_recurring_features.md`. If "monthly" isn't first-class, set `every: 4w` or implement scan-and-skip by reading the previous scan's date from `docs/competitive/scans/`.
- Cell flips that change Aigon's competitive positioning (acquisition, shutdown, net-new tier-1 entrant) get an inline note "consider feature `<slug>` to respond" — the agent does NOT auto-create those features. The maintainer decides at evaluation time.
- Untouched by the scan: `site/content/comparisons.mdx` (public page only updated in batches by hand) and `docs/marketing/positioning.md` (positioning copy only changes when category-shaping moves happen).

## Dependencies
- depends_on: competitive-positioning-foundation

## Out of Scope
- Auto-merging matrix patches (always human-reviewed).
- Twitter/X scraping (lower signal-to-noise; defer).
- Per-tool benchmark deep dives — the scan only references benchmark deltas, not their content.
- Updating the public page or positioning copy directly.

## Related
- Research: R44 — competitive positioning and landscape
- Set: competitive-positioning
- Prior features in set: competitive-positioning-foundation
