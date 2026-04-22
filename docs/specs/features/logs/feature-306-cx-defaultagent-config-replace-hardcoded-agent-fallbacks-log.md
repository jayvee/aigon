# Implementation Log: Feature 306 - defaultagent-config-replace-hardcoded-agent-fallbacks
Agent: cx → handed off to cc

Implementation completed per spec: added `getDefaultAgent()` in `lib/config.js`, replaced 10 user-facing hardcoded `'cc'` fallbacks (skipped the 6 spec-flagged structural/legacy sites), added dashboard `defaultAgent` select + `__AIGON_DEFAULT_AGENT__` injection, and wired a `doctor` warning for missing-agent misconfig.

## Code Review

**Reviewed by**: cu (code review pass)
**Date**: 2026-04-22

### Fixes Applied
- None needed — F306 touchpoints are coherent: `getDefaultAgent` normalizes to registered ids (invalid config values are ignored and fall through), `close-resolve` and `/api/ask` use the helper, entity review-agent resolution matches the spec, dashboard client fallbacks use `__AIGON_DEFAULT_AGENT__`, and `aigon doctor` warns on unregistered or missing-CLI `defaultAgent`.

### Residual Issues
- **Unrelated diff scope**: `main..feature-306` includes substantial changes beyond F306 (e.g. OpenCode agent/docs removal, `lib/feature-transfer.js` and `lib/global-config-migration.js` deletion, `.githooks/pre-commit` eslint strip). Confirm these belong on this branch before `feature-close`; if they are accidental, split or rebase so the PR stays scoped to `defaultAgent`.
- **No dedicated `getDefaultAgent` unit test**: `tests/` has no direct coverage of project → global → built-in precedence or invalid-id handling; consider a small integration test in a follow-up if you want T2 hardening without expanding scope here.
- **Dashboard `__AIGON_DEFAULT_AGENT__`**: Injected from `getDefaultAgent()` (server `cwd`), not the selected repo’s project config when multiple seed repos are loaded. Matches the spec’s `getDefaultAgent()` sketch; a per-repo value would need API-driven client state.

### Notes
- `npm test` (full suite including eslint) passed on the review worktree.
