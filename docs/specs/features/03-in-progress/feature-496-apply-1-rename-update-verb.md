---
complexity: medium
research: 48
set: apply-model
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-10T09:01:52.144Z", actor: "cli/feature-prioritise" }
---

# Feature: apply-1-rename-update-verb

## Summary

Rename `aigon update` to `aigon apply` and delete the `--pull` flag entirely. The current verb collides semantically with `npm update -g @senlabsai/aigon` — users cannot tell whether `aigon update` upgrades the CLI binary or re-applies aigon's managed files into a repo. The new verb pair makes the boundary unambiguous: **npm owns CLI upgrades**, **`aigon apply` owns project file application**. This is the foundational naming fix that the rest of the `apply-model` set builds on.

## User Stories

- [ ] As a customer, when I run `aigon apply`, I know it re-applies aigon's managed files into this repo (slash commands, agent configs, hooks, vendored docs) — not that it upgrades aigon itself.
- [ ] As a customer, when I want to upgrade aigon itself, I run `npm update -g @senlabsai/aigon` — there is no aigon CLI verb that competes with npm.
- [ ] As a customer who runs `aigon update` out of habit, I see a one-line deprecation warning and the command still works (redirects to `aigon apply`) for one release cycle.
- [ ] As a customer reading docs or `aigon --help`, the verb `update` is no longer mentioned anywhere except the deprecation note; `apply` is the canonical verb.

## Acceptance Criteria

- [ ] `aigon apply` is a working top-level verb that does what `aigon update` does today (re-vendor `.aigon/docs/`, refresh `.claude/`, `.cursor/`, `.codex/`, `.gemini/` slash commands and agent configs, remove deprecated commands, run migrations, auto-commit unless `--no-commit`).
- [ ] `aigon update` still works for one release cycle but prints a single deprecation warning to stderr: `⚠ "aigon update" is deprecated, use "aigon apply" — this alias will be removed in a future release.` Then redirects to the apply handler.
- [ ] The `--pull` flag is removed. `upgradeAigonCli()` is deleted from `lib/version.js`. All `pullFlag` conditional branches in `lib/commands/setup.js` are deleted.
- [ ] If a user runs `aigon update --pull` or `aigon apply --pull`, they get an error: `--pull is not supported. Upgrade aigon with: npm update -g @senlabsai/aigon`.
- [ ] All 166 references to `aigon update` are swept: docs (158), lib (7), AGENTS.md (1). Each becomes `aigon apply` except where it's documenting the deprecation alias itself.
- [ ] Slash command templates in `templates/generic/commands/*.md` that previously invoked `aigon update` now invoke `aigon apply`.
- [ ] Agent JSON configs in `templates/agents/*.json` that reference `aigon update` in hook commands or instructions now reference `aigon apply`.
- [ ] `aigon --help` lists `apply`, not `update`. The deprecated alias is hidden from help.
- [ ] One-line addition to `CONTRIBUTING.md` for contributors: "If you've pulled new aigon source, run `git pull && npm ci` in your aigon checkout, then `aigon apply --all` in your test repos."

## Validation

```bash
node --check aigon-cli.js
node --check lib/commands/setup.js
node --check lib/version.js
# Smoke: deprecation alias still works
aigon update --help 2>&1 | grep -q "deprecated"
# Smoke: --pull is rejected with the right message
aigon apply --pull 2>&1 | grep -q "npm update -g @senlabsai/aigon"
# Verify zero remaining `aigon update` references outside the deprecation alias path
grep -rn "aigon update" docs/ lib/ AGENTS.md README.md | grep -v "deprecated" | grep -v "alias" | wc -l
# Expected: 0 (or only the deprecation handler itself)
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Technical Approach

**Rename strategy.** Add a new `apply` command handler in `lib/commands/setup.js` that contains the existing `update` logic minus the `--pull` branch. Reduce the existing `update` handler to a deprecation shim:

```js
'update': async (args = []) => {
  console.error('⚠ "aigon update" is deprecated, use "aigon apply" — this alias will be removed in a future release.');
  return commands['apply'](args.filter(a => a !== '--pull'));
},
'apply': async (args = []) => {
  if (args.includes('--pull')) {
    console.error('Error: --pull is not supported.');
    console.error('       Upgrade aigon with: npm update -g @senlabsai/aigon');
    process.exit(1);
  }
  // ... existing update logic, sans pullFlag ...
},
```

**Delete `upgradeAigonCli()`** from `lib/version.js` and any imports of it. This was clone-install-only convenience that has no place in the product CLI.

**Doc sweep.** Use `grep -rln "aigon update" docs/ lib/ AGENTS.md` then `sed`-replace per file with manual review of each. Watch for context — the deprecation note itself must keep "aigon update" verbatim.

**Slash command template sweep.** Files in `templates/generic/commands/*.md` that currently say "Run `aigon update`" become "Run `aigon apply`". These templates regenerate into customer repos via `aigon install-agent`, so customers pick up the new verb on their next install/apply.

**Agent JSON sweep.** `templates/agents/*.json` may contain `aigon update` in hook commands (SessionStart hook payloads installed for cc/gg/cu). Replace with `aigon apply` and bump the install-manifest version so agents re-install on next `aigon apply`.

## Dependencies

- (none — this is the foundational rename)

## Out of Scope

- Changing what `aigon apply` does internally (the body logic is unchanged from current `update` minus `--pull`). Behavior changes belong to features #2-#5.
- The in-session drift notice (feature #3).
- Content-digest-driven drift detection (feature #2). This feature only renames the verb; the trigger is still semver-based until #2 lands.
- Multi-repo `aigon apply --all` (feature #5).

## Open Questions

- Should the deprecation alias print the warning every invocation, or only on first invocation per session? Default: every invocation (loud, accelerates migration).
- One release cycle for the alias, or two? Default: one. The set is John-only at this stage; can be aggressive.

## Related

- Research: #48 aigon-versioning-model-and-multi-repo-update-ux
- Set: apply-model
- Prior features in set: (none — this is the root)
