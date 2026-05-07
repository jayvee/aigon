# Implementation Log: Feature 481 - code-changes-tab-show-feature-commits-at-any-lifecycle-stage
Agent: cc

Added `GET /api/feature/:id/commits` (lib/dashboard-routes/commits.js) and a Code Changes drawer tab; route resolves from worktree (in-progress) or `Merge feature {id}` commit (done), tab is feature-only, expandable rows show files with +/- counts.
