# Implementation Log: Feature 426 - agent-onboarding-decision-tree-and-smoke-test
Agent: gg

## Status
Docs, onboard template, brewboard fixture (`feature-01-format-date`, AGENTS `## Commands`), and site/demo references aligned with F426.

## New API Surface
None. Added `docs/adding-agents.md`, `templates/feature-template-agent-onboard.md`, and brewboard seed updates in `scripts/setup-fixture.js`.

## Key Decisions
Added `## Commands` section to brewboard-seed `AGENTS.md` for validating a new agent with the brewboard smoke test. Also created the brewboard seed feature-01 for testing agent start.

## Gotchas / Known Issues
None.

## Explicitly Deferred
Docs linking to `AGENTS.md` is deferred to the F419 internal-doc-reorg feature.

## For the Next Feature in This Set
N/A

## Test Coverage
`npm run test:iterate` after review fixes (scoped).

## Code Review

**Reviewed by**: composer (code-review pass)
**Date**: 2026-04-28

### Fixes Applied
- Reverted mistaken primary rename `setup` → `onboarding` in `aigon-cli.js`, `lib/commands/setup.js`, `lib/templates.js`, `lib/onboarding/wizard.js` (out of scope for F426; conflicts with completed F416).
- Restored feature 416 spec + implementation log under `05-done` / `logs/`; removed stray `03-in-progress` copy of the 416 spec.
- Implemented missing brewboard seed work in-repo: `feature-01-format-date.md`, brewboard-only `## Commands` in seed `AGENTS.md` (`scripts/setup-fixture.js`), and updated brewboard tutorial + demo-guide paths for `format-date`.
- Corrected `op` label in `docs/adding-agents.md` (OpenDevin → OpenCode).

### Residual Issues
- None blocking. Re-run `npm run fixture:seed` or `aigon seed-reset brewboard --force` locally so `~/src/brewboard` matches the updated fixture generator.

### Notes
- First-run wizard remains `aigon setup` (alias `onboarding`) per mainline.
