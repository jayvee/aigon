## Summary

<!-- One paragraph: what does this PR do? -->

## Why

<!-- Why is this change needed? Link the related issue or feature spec if any. -->

Closes #

## How tested

<!-- List manual test steps and which automated tests cover this. -->

- [ ] `npm test` passes (core validation — lint incl. dashboard JS, diagrams, unit/integration/workflow)
- [ ] `npm run test:browser:smoke` passes (**required for any dashboard action/UI change** — critical-action surfaces)
- [ ] `npm run test:deploy` passes before push/release (release gate: core + full browser + test-budget)

## Checklist

- [ ] My changes follow the patterns described in `CONTRIBUTING.md` and `CLAUDE.md`
- [ ] I added a test for new code or for the bug I fixed (with a `// REGRESSION:` comment naming the issue it prevents)
- [ ] I have not added Pro / aigon-pro internals to public code (see CLAUDE.md "Aigon Pro")
- [ ] I updated relevant docs (`AGENTS.md`, `CLAUDE.md`, `docs/architecture.md`, `site/content/`)
- [ ] My commits have clear messages explaining the *why*

## Screenshots / output

<!-- For UI changes: include before/after screenshots. For CLI changes: include sample output. -->
