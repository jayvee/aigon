---
status: submitted
updated: 2026-03-15T22:41:57.052Z
startedAt: 2026-03-12T21:24:40+11:00
completedAt: 2026-03-12T21:29:23+11:00
autonomyRatio: 0.00
---

status: submitted
updated: 2026-03-12T08:51:05Z
---

# Implementation Log: Feature 09 - aigon-site-vocabulary-update
Agent: cx

## Plan
- Update user-facing website content (`index.html`) from old command vocabulary to new command vocabulary.
- Add a locked vocabulary table and full Drive/Fleet workflow table to the Docs section.
- Update repo-level website docs (`README.md`) command examples to match renamed commands.
- Validate by searching for stale command names in changed website files.

## Progress
- Replaced stale commands in mode examples, workflow steps, and terminal demo templates:
  - `feature-implement` -> `feature-do` / `feature-autopilot` (as appropriate)
  - `research-conduct` -> `research-do`
  - `feature-done` -> `feature-close`
- Updated the shared lifecycle snippet from `done` to `close`.
- Added a locked vocabulary table (old/new) and full workflow command map table in the `#docs` section.
- Updated the README workflow command block to use `feature-do` and `feature-close`.
- Added supporting styles in `css/style.css` for the new docs tables, including mobile horizontal scrolling behavior.
- Verified stale command references in website-facing files:
  - no remaining runtime/demo usage of old commands in `index.html` or `README.md`
  - remaining old-command strings are intentionally present in the locked vocabulary table’s "Old" column.
- Started and stopped a local dev server via `aigon dev-server` to validate runtime serving path and access URL.

## Decisions
- Kept non-command prose (for example, "implementation") unchanged to preserve readability and avoid over-replacing contextual text.
- Used `feature-autopilot` in autonomous CLI examples to reflect explicit autopilot naming in current workflow terminology.
- Kept existing shorthand aliases (`/afse`, `/afs`, `/afe`) where they were not part of the explicit rename scope, while updating the renamed canonical command examples in the same demos.
