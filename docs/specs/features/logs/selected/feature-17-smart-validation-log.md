# Implementation Log: Feature 17 - smart-validation

## Plan

Solo mode implementation on `feature-17-smart-validation` branch. Enhances the Ralph loop (Feature 16) with LLM-based acceptance criteria evaluation, multi-command profile presets, and checkbox auto-update.

## Progress

All 9 acceptance criteria implemented in a single session. Syntax verified with `node --check`. `aigon feature-validate 17 --dry-run` smoke-tested successfully.

## Decisions

### `parseAcceptanceCriteria` vs reusing `parseFeatureValidation`

Created a separate function for parsing `## Acceptance Criteria` checkboxes rather than reusing `parseFeatureValidation` (which reads `## Validation` bash commands). The two sections have different semantics: `## Validation` is commands to run, `## Acceptance Criteria` is human-readable goals. Keeping them separate avoids confusion.

Bug caught during testing: initial implementation was missing `if (!inSection) continue;` guard, causing user story items (from `## User Stories` section) to also be parsed. Fixed before commit.

### `getProfileValidationCommands` replaces `detectValidationCommand`

`detectValidationCommand` returned a single string. The new `getProfileValidationCommands` returns `[{ label, cmd }]` — same shape as the `allValidations` array already used inside `runRalphCommand`. This allowed a clean replacement without any structural change to the Ralph loop.

For the web profile specifically, `npm run build` and `npm run lint` are only included if those scripts actually exist in `package.json`, to avoid false failures on projects that don't have them.

### Batched LLM evaluation

Rather than one `claude -p` call per subjective criterion (which would be slow for specs with 10+ criteria), all subjective criteria are sent in a single prompt with numbered responses. The parser matches `1. YES: ...` / `2. NO: ...` lines back to the original criteria.

Graceful fallback: if `claude` isn't in PATH or returns non-zero, all subjective criteria get `{ passed: null, skipped: true }`. Skipped criteria do not block Ralph loop success — this avoids breaking the loop when LLM evaluation fails transiently.

### Objective vs subjective classification

Objective patterns: test(s) pass/fail/run, build(s) succeed/fail/compile, lint, type-check, no errors, compiles, exit code, syntax check/valid. Everything else is subjective.

This deliberately errs toward `subjective` — better to over-evaluate with LLM than to silently mark criteria as passed without checking them.

### Checkbox updates happen inline

`updateSpecCheckboxes` writes `- [x]` back to the spec file immediately when criteria pass. This means each Ralph iteration starts with the current state of the spec (the loop re-reads the spec at the top of each iteration). Agents in later iterations see which criteria are already verified.

### criteriaFeedback in Ralph prompt

When smart validation fails (some criteria not met), the failing criteria are formatted and stored as `criteriaFeedback`. This string is injected into the next iteration's prompt under "Criteria feedback from previous iteration". Gives the agent targeted context about what to fix.

### Standalone `aigon feature-validate <ID>` command

Added as a convenient way to run smart validation outside of the Ralph loop — useful for manual checks, CI integration, or understanding what would be evaluated before starting a Ralph run.

`--dry-run` shows criteria and validation commands without executing anything.
`--no-update` runs evaluation but skips writing checkboxes back to spec (read-only mode).
