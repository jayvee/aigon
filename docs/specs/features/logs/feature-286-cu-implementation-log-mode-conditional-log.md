# Implementation Log: Feature 286 - implementation-log-mode-conditional
Agent: cu

## Plan

- Extend `lib/profile-placeholders.js` with mode + `logging_level` resolution, Fleet-specific log copy, explicit skip line, install-agent static guide.
- Gate `init_log` / `feature-now` / worktree starter logs via `shouldWriteImplementationLogStarter`.
- Wire `install-agent` with `forCommandTemplateInstall`; cx uses cwd-based `getProfilePlaceholders({ repoPath })`.
- Align `feature-do` Fleet detection (`>= 1` sibling worktree); refresh docs + regression test under test budget.

## Progress

- Implemented and ran `npm test` + `scripts/check-test-budget.sh`.

## Decisions

- Install-time templates cannot know cwd at agent runtime; `forCommandTemplateInstall` emits a compact tri-mode guide instead of resolving Drive-from-repo-root (which would wrongly skip Fleet).
