# Implementation Log: Feature 127 - manifest-and-branch-safety
Agent: cc

## Plan

Targeted 4 root causes from the 2026-03-20/21 incident. Branch guard (RC1) was already implemented. Focused on: manifest read/write separation (RC2), feature-start agent reliability (RC3/RC4), and dashboard dispatch verification (RC4).

## Progress

- Verified `assertOnDefaultBranch()` already exists in `lib/git.js` and is called in all required commands (feature-create, feature-prioritise, feature-start, feature-close, feature-eval, research-*, feedback-*)
- Verified `readManifest()` code was already correct (returns transient derived object, no persistence) — but the test was wrong
- Fixed `lib/manifest.test.js`: removed assertion that readManifest persists; added ensureManifest persistence test
- Fixed `lib/commands/feature.js`: feature-start now always merges new agents into existing manifest agent list (was previously skipping when manifest already had agents)
- Added post-dispatch verification in `lib/dashboard-server.js`: after feature-start, reads manifest and checks agents were registered
- Added agentWarning toast in `templates/dashboard/js/api.js`
- Added 3 new tests in `aigon-cli.test.js`: agent merging, dashboard command args, dashboard request parsing

## Decisions

- **Agent merge vs replace**: Chose merge (Set union) so running `feature-start 55 cc gg` when `['cc']` is already registered results in `['cc', 'gg']`, not just `['gg']`. This preserves existing agents.
- **Dashboard verification is best-effort**: The post-dispatch manifest check catches missing agents but doesn't fail the whole action — the CLI may have legitimate reasons for not writing agents (e.g., drive mode with no agents specified).
- **7 pre-existing test failures**: All 7 failing tests were already failing before this feature (verified via git stash). They relate to feature-eval, research-synthesize, buildResearchAgentCommand, and FEATURE_STAGES — unrelated to this work.

## Files Changed

- `lib/manifest.test.js` — Fixed readManifest test expectations
- `lib/commands/feature.js` — feature-start always merges agents
- `lib/dashboard-server.js` — Post-dispatch agent verification
- `templates/dashboard/js/api.js` — agentWarning toast
- `aigon-cli.test.js` — 3 new tests
