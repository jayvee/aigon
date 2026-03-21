# Evaluation: Feature 119 - security-scan-foundation

**Mode:** Fleet (Multi-agent comparison)

## Spec
See: `./docs/specs/features/04-in-evaluation/feature-119-security-scan-foundation.md`

## Implementations to Compare

- [x] **cc** (Claude): `/Users/jviner/src/aigon-worktrees/feature-119-cc-security-scan-foundation`
- [x] **cx** (Codex): `/Users/jviner/src/aigon-worktrees/feature-119-cx-security-scan-foundation`

## Evaluation Criteria

| Criteria | cc | cx |
|---|---|---|
| Code Quality | 8/10 | 9/10 |
| Spec Compliance | 9/10 | 10/10 |
| Performance | 9/10 | 9/10 |
| Maintainability | 7/10 | 9/10 |
| **Total** | **33/40** | **37/40** |

## Summary

| Agent | Lines | Score |
|---|---|---|
| cc | 374 | 33/40 |
| cx | 335 | 37/40 |

### Strengths & Weaknesses

#### cc (Claude)
- Strengths:
  - Excellent test suite — dedicated `security.test.js` with 10 tests including a real worktree test that verifies hook works across worktrees
  - Friendly, well-formatted error messages with emoji and bypass instructions
  - Separate config test file with 4 security-specific tests
- Weaknesses:
  - Hook uses `#!/bin/bash` instead of `#!/bin/sh` — less portable (bash not guaranteed on all systems)
  - Hook content is duplicated: once in `.githooks/pre-commit` file and again as a string literal in `scaffoldPreCommitHook()` — two copies to maintain
  - Generic shallow spread for all object config keys in `getEffectiveConfig()` — could cause unintended merging for future config objects that should be fully replaced
  - `init` does NOT call `ensureGitHooksPath()` — only scaffolds the hook file but doesn't set `core.hooksPath`, so hooks won't actually run after init alone
  - No separate doctor check for the hook file itself being missing (only checks hooksPath)
  - New test files (`security.test.js`, `config.test.js`) are standalone — not integrated into existing test runner

#### cx (Codex)
- Strengths:
  - POSIX `#!/bin/sh` hook — portable across all Unix systems
  - Single source of truth for hook content: `PRE_COMMIT_HOOK_CONTENT` constant, used for both scaffolding and the static file
  - Hook uses `--diff-filter=ACMR` to only check added/copied/modified/renamed files (more precise)
  - Two separate doctor checks: `pre-commit-hook-missing` AND `git-hooks-path-missing`
  - `isHooksPathConfigured()` handles path normalization (relative, `./` prefix, absolute) — more robust
  - Idempotent hook provisioning: only rewrites if content differs, always ensures executable bit
  - `config init` in `infra.js` writes security block to project config and displays config options to user
  - Tests integrated into existing `aigon-cli.test.js` test file
  - Exports test helpers via `_test` for future test use
  - Hook regex handles subdirectory `.env` files: `(^|/)\.env$` matches `subdir/.env`
- Weaknesses:
  - Tests rely on the large monolithic test file (harder to run in isolation)
  - `init` scaffolds hook but doesn't call `ensureHooksPathConfigured()` — same gap as cc (though install-agent does)

## Recommendation

**Winner:** cx (Codex)

**Rationale:** Codex delivers a more robust implementation: POSIX-portable hook, single source of truth for hook content, more precise git diff filtering, better path normalization in `isHooksPathConfigured()`, two separate doctor checks, and proper `config init` integration. The code is tighter and more defensively written.

**Cross-pollination:** Before merging, consider adopting from cc: the dedicated worktree behavior test in `security.test.js` (lines 155-182) that creates a real worktree and verifies the hook blocks `.env.local` commits there. This directly validates acceptance criterion #4 ("Hooks work in worktrees") and is the strongest test in either implementation.
