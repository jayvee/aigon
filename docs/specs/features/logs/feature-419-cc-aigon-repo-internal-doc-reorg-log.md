# Implementation Log: Feature 419 - aigon-repo-internal-doc-reorg
Agent: cc

Pure-docs reorg: moved aigon-next briefs → `docs/proposals/`, modularity review → `docs/reviews/2026-04-06/`, demo-guide + media → `docs/demos/`; created `docs/README.md` catalog and `docs/feature-sets.md` (+ template); patched stale module-map entries in `AGENTS.md` (dashboard-routes ~60-line aggregator, commands/setup ~3,492 lines, agent-registry ~655 lines + F414 helpers) and `docs/architecture.md`; replaced AGENTS Reading Order with single pointer to `docs/README.md`. `lib/security.js`: `maxBuffer` on `spawnSync` for large `git show` blobs (iterate gate). Iterate-loop tests pass.

## Code Review

**Reviewed by**: cu (Cursor agent, code-review pass)
**Date**: 2026-04-28

### Fixes Applied
- `d6f30832` — `fix(review): nest dashboard route modules under dashboard-routes` — `docs/architecture.md` listed `lib/worktree.js` (and following domain bullets) as an eighth entry under the “Dashboard route modules” subsection, contradicting the “seven sub-files” contract. Nested the seven `lib/dashboard-routes/*.js` entries under the `lib/dashboard-routes.js` bullet and restored `lib/worktree.js` as a top-level domain module.

### Residual Issues
- **Merge `main` before close**: This branch forked at `7cf31ebe` and `main` has advanced (e.g. feature 425, cursor trust). Use `git merge main` (or rebase) before `feature-close` so the PR does not drop upstream commits.
- **Implementation log accuracy**: The earlier log line said “No `lib/` changes”; `832a9c20` is docs-only but `9110c71b` adds `maxBuffer` in `lib/security.js`. Worth aligning prose with reality for auditors.

### Notes
- Review diff scope: use `git diff main...HEAD` (three-dot) on long-lived feature branches — `main..HEAD` falsely showed massive `lib/` reversions because `main` is ahead of the merge-base.
- Acceptance checks: spec validation script passes; grep for legacy `docs/{aigon-next,modularity-review,demo-guide,media}` paths finds hits only under `docs/specs/`, as required.
- Catalog `docs/README.md` is 60 lines (under the ≤80 target). `Reference` subgroup for competitive/marketing matches the spec’s default to keep those folders at `docs/` root.
