# Implementation Log: Feature 695 - remove-aigon-pro-step-from-setup-wizard
Agent: cc

## Status

Complete. The wizard is eight steps; `pro` is gone from `STEP_IDS`, from
`lib/onboarding/wizard.js`, and from the docs-site step list. The vault step
drives `lib/backup.js` with no gate. `npm run test:core` green.

## New API Surface

`lib/onboarding/wizard.js` now exports its module-private `shouldRunStep` so the
`-1` ordering hazard below is testable. Nothing else changed shape; no export was
removed. `readGlobalConfig` / `writeGlobalConfig` stay — the `seed-repo` and
`demo` steps use them.

## Key Decisions

**Legacy `steps.pro` is ignored, not stripped.** The spec's Open Question offered
stripping in `writeStepState()` by filtering unknown keys. I did not: filtering
"unknown" keys on write is precisely the behaviour that breaks a future *added*
step during a partial upgrade (a state file written by an older binary loses the
new step's status), which is a worse failure than a dead key sitting in a JSON
file. Every reader — `isOnboardingComplete`, `getFirstIncompleteStep`,
`getFirstResumableStep` — iterates `STEP_IDS`, so an extra key is inert. Verified
by test and by a real CLI run against a hand-written legacy state file, not
assumed.

**The `-1` hazard was real and is handled explicitly.** `shouldRunStep`'s
ordering guard did `STEP_IDS.indexOf(stepId) < STEP_IDS.indexOf(startStep)`. With
a pre-F695 state file resumed mid-`pro`, `startStep` is `'pro'`, `indexOf` is
`-1`, and every step compares as "at or after start" — re-running the whole
wizard. The guard now only applies when `startIndex >= 0` and otherwise falls
through to the persisted-status check, so completed steps stay completed.

**`proKey` migration was already done by F693.** `lib/migration.js`
`drop_pro_key` removes it from `~/.aigon/config.json`, and
`lib/commands/setup/doctor.js` reports/fixes a stale key. Per the spec's
"coordinate with F693 — do not add a second one", I added nothing.

**The final block is labelled `// ── Finish ──`, not `// ── Step 9 ──`.** It was
mislabelled "Step 8" before while sitting after step 9; it is wrap-up, not a
persisted step, and giving it a number invites the same drift again.

## Gotchas / Known Issues

- **I ran `aigon setup --yes` against my real `$HOME` once** before re-running it
  isolated (the `HOME=` assignment was missing from the env). It rewrote
  `~/.aigon/onboarding-state.json` (optional steps → `skipped`, new
  `completedAt`). `config.json` was not damaged: `machineId`, `onboarded`, and
  the 17 registered repos survived, and `--yes` is conservative enough that it
  cloned nothing and started nothing. Reported to the operator.
- **The interactive vault path is not machine-verified.** I drove the un-gated
  step far enough to prove it reaches `lib/backup.js` with no Pro gate
  (`aigon setup --step vault` reaches `backup.getRemote()` and the "Backup
  skipped" note), and confirmed `getRemote` / `createVaultOnGitHub` / `configure`
  / `push` all exist on the merged module. Driving the full prompt chain through
  a pty hung on clack, and the happy path creates a real GitHub repo, so I
  stopped rather than rabbit-hole. It is item 5–6 of the manual checklist.
- **`docker/clean-room/smoke-test.sh` scenario 3 is now dead code**, but not
  because of this feature: it installs the `@senlabsai/aigon-pro` package and
  calls `aigon pro activate`, a verb F693 deleted. It contains **no** `aigon
  setup` invocation and no step-count assertion, so this feature's AC for that
  file is vacuous — there was no unattended-wizard Pro plumbing to update. F694
  owns `docker/` and should delete the scenario outright.
- `docker/clean-room/README.md` already listed seed-clone as step 4 (i.e. it was
  pre-renumbered / previously wrong under the nine-step wizard). Only the step-8
  line needed fixing, and only its wording: "Aigon Pro vault" → "Vault backup".

## Explicitly Deferred

- Deleting smoke-test scenario 3 and `preflight_pro_tarball` — F694 (`docker/`).
- `site/content/reference/commands/pro/{status,activate}.mdx` and
  `site/content/guides/dashboard.mdx:280` still document `proKey` and the removed
  `aigon pro` verb — F694 owns the docs-site Pro teardown. This feature only
  corrected `guides/setup-wizard.mdx`, which it renumbers.
- The generic stack trace the CLI prints after a clear `--step` usage error. The
  clear message *does* print first (`❌ Usage: … Invalid setup step: pro`) and the
  wizard does not fall back to running from the top, so the AC is met; the
  trailing trace is pre-existing behaviour for every invalid-arg path.

## For the Next Feature in This Set

F694: the wizard's step list is now stable at eight
(`prereqs terminal agents seed-repo repos server demo vault`) — safe to write
prose against. Three shared files are already partly reconciled by this feature:
`site/content/guides/setup-wizard.mdx` (renumbered, Pro entry removed),
`docker/clean-room/README.md` (step-8 wording), `docker/clean-room/smoke-test.sh`
(untouched — see Gotchas; it is yours to gut).

## Test Coverage

- `tests/unit/onboarding-state.test.js` — 4 new cases (7 total, all pass): the
  eight canonical ids in order + `validateStepIds(['pro'])` rejects; legacy
  `steps.pro` resumes at `seed-repo`; a complete nine-step legacy file reads as
  complete forever; wizard `shouldRunStep` survives `startStep === 'pro'`.
- `npm run test:core` green — lint, path literals, template leaks, module graph,
  alpine bindings, diagrams, code-tour, budget (18261/200000), unit 44/44,
  integration 53/53, workflow 2/2.
- Real-CLI validation in an isolated `HOME`: `setup --yes` prints eight steps;
  `setup --yes --resume` over a legacy `pro` state file leaves
  `prereqs/terminal/agents` at `done` and does not re-run them; `--step pro` is
  rejected with the eight valid ids listed.
- **Unblocked the gate:** `scripts/check-code-tour.js` was failing on four
  excerpts drifted by the F693 merge (`createProCommands` removed from
  `aigon-cli.js`, `applyForceProOverride` removed from `store.js`, two anchors
  off by one). Pre-existing at `42bd9858e` — verified by checking the parent
  commit out before touching it. Fixed in `fix: unblock agent-status gate …`.
- `npm run test:browser` not run mid-iteration (pre-authorised); the deploy gate
  covers it before close.

## Code Review

**Reviewed by**: cursor-agent (code-review)
**Date**: 2026-07-25

### Fixes Applied
- None — implementation was clean

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- None

### Notes
- `STEP_IDS`, wizard step removal, vault un-gating, legacy `steps.pro` handling,
  `--step pro` rejection, and docs/README updates all match the spec acceptance
  criteria.
- The `shouldRunStep` `-1` guard is defensive (resume now derives `startStep` from
  `getFirstResumableStep`, which cannot return `'pro'` after F695) but is
  well-tested and harmless.
- `proKey` migration correctly deferred to F693's `drop_pro_key`; no duplicate
  migration added.
- `docker/clean-room/smoke-test.sh` left untouched per F694 ownership — reasonable
  given no wizard/step-count assertions in that file.
