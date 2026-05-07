---
complexity: low
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-07T05:00:33.403Z", actor: "cli/feature-prioritise" }
---

# Feature: pro-activate-command

## Summary

Add an `aigon pro activate <key>` command that writes the Pro key to `~/.aigon/config.json` once. Update `lib/pro.js` to require `@senlabsai/aigon-pro` (correcting the stale `@aigon/pro` path). Update `assertProCapability` error messaging to point users at the activate command. Revise `site/content/guides/pro-installation.mdx` to reflect the new 3-step install flow.

## User Stories

- [ ] As a beta tester, I run `aigon pro activate <key>` once and Pro is active on every subsequent `aigon server start`, including via launchd, without touching env vars or shell profiles
- [ ] As a user without a key, I see a clear message telling me to run `aigon pro activate <key>` when I try to use a Pro feature

## Acceptance Criteria

- [ ] `aigon pro activate abc123` writes `{"proKey":"abc123"}` to `~/.aigon/config.json` (merges with existing keys, does not overwrite unrelated config)
- [ ] `aigon pro activate` with no key argument prints usage error and exits 1
- [ ] `aigon pro status` prints whether `@senlabsai/aigon-pro` is installed and whether a `proKey` exists in `~/.aigon/config.json`
- [ ] `lib/pro.js` requires `@senlabsai/aigon-pro` (not `@aigon/pro`)
- [ ] `assertProCapability` output says: `Install: npm install -g @senlabsai/aigon-pro` and `Activate: aigon pro activate <your-key>`
- [ ] `site/content/guides/pro-installation.mdx` shows the 3-step flow: install package → activate key → restart server. No PAT or `.npmrc` instructions.

## Validation

```bash
node -c aigon-cli.js
node -c lib/pro.js
npm test
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Technical Approach

- Add `pro` subcommand group in `lib/commands/` (or extend `lib/commands/misc.js` if a subcommand group is too heavy — follow existing patterns)
- `activate`: read `~/.aigon/config.json` via existing global config helpers (check `lib/config.js`), set `proKey`, write back
- `status`: use `require.resolve('@senlabsai/aigon-pro')` in a try/catch for install check; read `proKey` from global config for activation check
- Update `lib/pro.js` require path only — no other logic changes
- Docs update to `site/content/guides/pro-installation.mdx` is part of this feature

## Dependencies

- None (F486 rename is independent and can run in parallel)

## Out of Scope

- Actual key validation (lives in `@senlabsai/aigon-pro` — F433 in aigon-pro repo)
- Package rename sweep (F486)
- `aigon pro deactivate`
