# Evaluation: Feature 20 - cross-provider-eval

**Mode:** Arena (Multi-agent comparison)

## Spec
See: `./docs/specs/features/04-in-evaluation/feature-20-cross-provider-eval.md`

## Implementations to Compare

- [x] **cc** (Claude): `/Users/jviner/src/aigon-worktrees/feature-20-cc-cross-provider-eval`
- [x] **cx** (Codex): `/Users/jviner/src/aigon-worktrees/feature-20-cx-cross-provider-eval`

## Evaluation Criteria

| Criteria | cc | cx |
|----------|---|---|
| Code Quality | 8/10 | 7/10 |
| Spec Compliance | 8/10 | 9/10 |
| Performance | 9/10 | 7/10 |
| Maintainability | 9/10 | 6/10 |

## Summary

### Strengths & Weaknesses

#### cc (Claude)
- Strengths:
  - Clean, minimal implementation: 96 lines of CLI changes — focused on the core need
  - `PROVIDER_FAMILIES` constant and `isSameProviderFamily()` are well-designed: `varies` never triggers, unknown agents return false
  - 17 unit tests covering all family combinations, edge cases, and unknowns — first test file in the project
  - Updated `package.json` test script from placeholder to `node aigon-cli.test.js`
  - Bias warning format matches the spec's example exactly
  - `--allow-same-model-judge` flag correctly strips before positional arg parsing
  - Handles both arena (warns if evaluator matches ANY implementer) and solo (infers from worktree or branch name)
  - Shows evaluator model from `evaluate` task type config in summary output
- Weaknesses:
  - `--agent` flag is mentioned in the warning output but not wired up — users can't actually override the evaluator via CLI yet
  - No doc/template updates (feature-eval.md, GUIDE.md, help text limited to usage line)
  - Tests duplicate the constants/functions rather than importing — fragile if the main code changes

#### cx (Codex)
- Strengths:
  - Most complete spec compliance: `--agent=<id>` flag fully wired with validation and alias resolution
  - Rich evaluator selection logic: arena defaults (non-implementer → cross-majority-family → rotation), solo inference (worktree → log filename → log content → branch → default)
  - Generates evaluator launch command with `evaluate` task-type model injection
  - Writes judge recommendation into evaluation template files
  - Updated `feature-eval.md` template, `docs/GUIDE.md`, help text, and `COMMAND_ARG_HINTS`
  - Arena evaluator rotation by feature ID for deterministic distribution
- Weaknesses:
  - **368 lines of CLI changes** — massively over-engineered for the core requirement. 12+ new helper functions, many of which duplicate existing patterns
  - `inferSoloImplementerAgent` has 4 fallback strategies including reading log file contents — complex when branch name parsing covers 95% of cases
  - `selectArenaEvaluatorAgent` has majority-family counting and rotation logic that adds complexity for edge cases that rarely occur
  - `EVAL_AGENT_PRIORITY` hardcodes a preference order (gg > cx > cc > cu) — opinionated without spec justification
  - `cu` mapped to `'cursor'` family instead of `'varies'` — different from spec which says `varies` since Cursor proxies multiple providers
  - No tests
  - `buildAgentTaskPrompt` and `buildAgentTaskLaunchCommand` partially duplicate existing `getAgentCliConfig` patterns

## Recommendation

**Winner:** cc (Claude)

**Rationale:** cc delivers the core value — bias detection and warning — in 96 clean lines with 17 passing tests. The implementation is focused, correct, and maintainable. cx is more feature-complete (the `--agent` flag works, docs are updated, launch commands are generated) but at 368 lines it's significantly over-engineered. The arena evaluator selection logic with majority-family counting and feature-ID-based rotation adds complexity for edge cases that don't justify it. cx also maps Cursor to `'cursor'` instead of `'varies'`, deviating from the spec.

**Cross-pollination:** Worth adopting from cx:
- The `--agent=<id>` flag wiring (cc mentions it in output but doesn't implement it)
- `COMMAND_ARG_HINTS` update for `feature-eval`
- `feature-eval.md` template updates (adding `--agent` and `--allow-same-model-judge` to usage)
- `docs/GUIDE.md` evaluation guidance updates (replacing manual model-switch instructions with the new flags)
- Help text examples showing the new flags

