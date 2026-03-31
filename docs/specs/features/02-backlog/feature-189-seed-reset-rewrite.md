# Feature: seed-reset-rewrite

## Summary

Complete rewrite of `seed-reset` to be robust and predictable. The current implementation has been patched 8+ times in a single session and still produces broken states. The fundamental approach is correct (clone from canonical seed repo, install agents, commit), but the execution has too many edge cases and the seed repos themselves drift out of sync with the CLI.

## Problems encountered (chronological, from Mar 23 2026 session)

1. **Baseline commit detection was brittle** — grepped git log for specific commit messages, missed repos that were reset before
2. **In-progress features not moved to backlog** — board showed orphaned in-progress features with no sessions
3. **Feature logs/evals not cleaned up** — stale logs from prior runs survived reset
4. **No agent re-install after reset** — repo was left on stale aigon version, required manual install-agent
5. **.gitignore modification after hard reset** — created new commits in a "reset to clean state" operation
6. **Seed repo captured post-implementation code** — dark-mode was already built in the source, agents had nothing to do
7. **Fake done features** — onboarding-flow and search marked done but not implemented in code
8. **install-agent output not committed** — worktrees branched off stale committed state, got old templates
9. **rm -rf worktrees dir failed with ENOTEMPTY** — .git worktree references blocked deletion
10. **Dashboard crashed during reset** — readdirSync on deleted repo dir caused uncaughtException and process.exit
11. **Dev server fails in worktrees** — `npm run dev` fails with "next: command not found" because deps not installed; dev-server start should auto-detect and run npm install

## User Stories

- [ ] As a user, I run `aigon seed-reset ~/src/brewboard --force` and get a perfect starting state every time, regardless of what was there before
- [ ] As a user, I can immediately start a feature after reset and agents get current templates
- [ ] As a user, the dashboard stays alive during reset and recovers when the repo reappears

## Acceptance Criteria

- [ ] `aigon seed-reset <path> --force` produces identical results every time, regardless of prior state
- [ ] After reset, `aigon board` shows the correct starting state (all features in backlog/inbox, no in-progress)
- [ ] After reset, `aigon feature-start <ID> cc gg` creates worktrees with up-to-date templates
- [ ] Agents that implement features find real work to do (no pre-implemented code in backlog features)
- [ ] `seed-reset` during a running dashboard does not crash the dashboard
- [ ] `seed-reset` handles: missing repo dir, locked files, ENOTEMPTY, in-use git worktrees
- [ ] `seed-reset --dry-run` shows exactly what will happen without doing it
- [ ] Cleanup covers: tmux sessions, worktrees dir, agent processes, dev-proxy entries, Claude settings trust/permissions
- [ ] Agent install is auto-committed so worktrees inherit current templates
- [ ] Seed repos on GitHub are the frozen canonical state — seed-reset never modifies them

## Validation

```bash
node -c lib/commands/setup.js
```

## Technical Approach

### Core design: three operations, nothing else

1. **Nuke** — kill sessions, remove dirs (handle every error case: ENOTEMPTY, EBUSY, locked files, missing dirs)
2. **Clone** — `git clone` from seed repo (single source of truth, only operation that can abort)
3. **Provision** — install agents, rebuild manifests, commit everything (all non-fatal)

No file shuffling, no baseline detection, no spec moves, no delta patching. Every step wrapped in try/catch with clear logging. Non-critical failures never abort.

### Seed registry (hardcoded, simple)

```js
const SEED_REGISTRY = {
    brewboard: 'https://github.com/jayvee/brewboard-seed.git',
    trailhead: 'https://github.com/jayvee/trailhead-seed.git',
};
```

### Seed repo contract

A seed repo must:
- Contain app source code with NO backlog features pre-implemented
- Contain spec files in the correct stage folders (inbox, backlog — never in-progress or fake done)
- Contain agent install artifacts (but seed-reset re-installs anyway, so stale artifacts are overwritten)
- Have a clean git history (single initial commit is fine)

### What seed-reset must NOT do

- Modify the seed repo on GitHub
- Detect baseline commits or scan git history
- Move spec files between folders
- Patch .gitignore and create commits for it
- Assume anything about the current state of the target directory

### Related: dev-server should auto-install deps

`aigon dev-server start` should detect "command not found" failures and automatically run `npm install` before retrying. This prevents the common worktree failure where deps aren't installed.

## Dependencies

- `lib/commands/setup.js` — seed-reset command
- `lib/worktree.js` — tmux session cleanup helpers
- GitHub repos: `jayvee/brewboard-seed`, `jayvee/trailhead-seed`

## Out of Scope

- `aigon seed-update` command (maintaining the seed repos)
- Automated seed repo CI/CD
- New seed repos beyond brewboard and trailhead
- Dashboard UI changes

## Open Questions

- Should seed-reset also run `npm install` so the repo is immediately runnable?
- Should the seed registry be configurable or hardcoded?

## Related

- All fixes from Mar 23 session: commits 5a20e4e1 through a5e572a3
- Dashboard crash fix: commit 4447cba0
