---
commit_count: 3
lines_added: 387
lines_removed: 16
lines_changed: 403
files_touched: 10
fix_commit_count: 1
fix_commit_ratio: 0.333
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 71
output_tokens: 15300
cache_creation_input_tokens: 71974
cache_read_input_tokens: 1861480
thinking_tokens: 0
total_tokens: 1948825
billable_tokens: 15371
cost_usd: 1.0581
sessions: 1
model: "claude-sonnet-4-6"
tokens_per_line_changed: null
---
# Implementation Log: Feature 431 - aigon-pro-github-packages-beta-distribution
Agent: cc

## Status
Complete. All acceptance criteria met and committed.

## New API Surface
- `scripts/add-beta-tester.sh <github-username>` — grants read access to `senlabs/aigon-pro-access` repo via `gh` CLI and appends to roster
- `scripts/remove-beta-tester.sh <github-username>` — revokes collaborator access and marks roster entry as revoked
- `.github/workflows/publish-pro.yml` — manual `workflow_dispatch` publish to GitHub Packages

## Key Decisions
- **Manual trigger only** for beta phase (`workflow_dispatch`). Auto-publish on push to main can be added later when beta is stable.
- **Access via `aigon-pro-access` repo** (not per-package allowlist, which GitHub Packages doesn't support for npm). Beta testers need read access to that repo in the `senlabs` org.
- **`@senlabs` scope** chosen (not `@aigon`) to align with the senlabs GitHub org where the package is hosted.
- Outreach template asks for GitHub username upfront to keep the invite flow to 2 messages.

## Gotchas / Known Issues
- The `senlabs` GitHub org and `senlabs/aigon-pro-access` private repo must be created before running the access scripts.
- `npm publish --dry-run` includes `.aigon/` contents in the tarball — an `.npmignore` may be worth adding before public beta.

## Explicitly Deferred
- `.npmignore` to exclude internal `.aigon/` and `docs/specs/` from tarball
- Auto-publish on push to main (deferred until beta proves stable)

## For the Next Feature in This Set
- Create `senlabs` GitHub org and `aigon-pro-access` private repo to activate the scripts
- Add `.npmignore` before first real publish

## Test Coverage
No new tests — this feature is infrastructure/config/docs only. Existing test suite (11 unit + 9 backup tests) passes unchanged.

## Code Review

**Reviewed by**: Composer
**Date**: 2026-05-07

### Fixes Applied
- `52f7617` fix(review): publishable package metadata and narrower npm files

### Escalated Issues (exceptions only)
- None.

### Notes
- `package.json` had `aigon` as `file:../aigon`, which is carried unchanged into the published tarball and breaks `npm install` for beta testers and GitHub Actions. Resolved with a pinned public git dependency (`jayvee/aigon#v2.54.7`). Bumping that tag over time is an operational follow-up when OSS releases require it.
- Tarball bloat and internal data exposure (formerly entire `.aigon/` tree) is addressed with a `files` whitelist rather than the deferred `.npmignore` from implementation.
- This repo has no `npm run test:iterate` script; reviewer ran `npm test` (pass) as the post-fix gate.
