---
aigon_id: F695
complexity: medium
agent: cc
set: pro-merge
depends_on: [693]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-25T03:37:37.085Z", actor: "cli/feature-prioritise" }
---

# Feature: remove aigon pro step from setup wizard

## Summary

`aigon setup` currently runs a nine-step onboarding wizard whose **step 4 is "pro"**: it
offers to `npm install -g @senlabsai/aigon-pro@beta`, then prompts for a beta key and writes
it to `~/.aigon/config.json` as `proKey`. **Step 9 ("vault") also gates on Pro** — it refuses
to configure vault backup unless the Pro package is installed, printing "Vault backup is a
Pro feature — skipping setup."

With Pro merged into OSS (F693) there is no package to install, no key to enter, and no
reason to skip vault setup. This feature removes the `pro` step from the wizard entirely,
un-gates the vault step, and handles the two migration hazards that fall out: users with a
half-finished `~/.aigon/onboarding-state.json` that still names a `pro` step, and users with
a now-meaningless `proKey` in their global config.

The wizard goes from nine steps to eight. Every step count, step number, and resume path that
assumes nine must move with it.

## User Stories

- [ ] As someone running `aigon setup` on a fresh machine, I am never asked to install a
      second package or paste a key — the wizard goes prereqs → terminal → agents → seed-repo
      → repos → server → demo → vault.
- [ ] As someone reaching the vault step, backup configuration runs for me. It is no longer
      skipped with a "Pro feature" note.
- [ ] As someone who ran `aigon setup` before the upgrade and stopped partway, `aigon setup --resume`
      picks up at the right step instead of getting stuck on, or re-running, a step that no
      longer exists.
- [ ] As someone who previously activated a Pro beta key, the stale `proKey` in
      `~/.aigon/config.json` is cleaned up rather than sitting there implying a tier exists.
- [ ] As someone running the unattended install path (`aigon setup --yes`), no `AIGON_PRO_KEY`
      environment variable is consulted and the run does not fail for its absence.

## Acceptance Criteria

### Wizard step removal

- [ ] `STEP_IDS` in `lib/onboarding/state.js:8` becomes
      `['prereqs', 'terminal', 'agents', 'seed-repo', 'repos', 'server', 'demo', 'vault']`
      — eight entries, `'pro'` gone.
- [ ] The entire `// ── Step 4: pro ──` block in `lib/onboarding/wizard.js` (~lines 373–436)
      is deleted, including both the `--yes` branch and the interactive branch.
- [ ] The helpers `isProPackageInstalled()` (~lines 77–92) and `installProPackage()`
      (~lines 110–116) are deleted. `readGlobalConfig()` / `writeGlobalConfig()` stay — other
      steps use them.
- [ ] `process.env.AIGON_PRO_KEY` is not read anywhere in `lib/`.
- [ ] The remaining step comments are renumbered so `// ── Step N: <id> ──` matches the new
      index (`seed-repo` becomes step 4, …, `vault` becomes step 8).

### Vault step un-gated

- [ ] The `// ── Step 8: vault ──` block no longer requires `@aigon/pro`. The
      `const { isProAvailable, getPro } = require('../pro')` line and the
      `if (!backup) { … 'Vault backup is a Pro feature — skipping setup.' … }` guard are gone;
      `backup` is required directly from the merged `lib/backup.js`.
- [ ] The now-redundant `else {` wrapper and its indentation are cleaned up rather than left
      as a dangling block.
- [ ] Running `aigon setup` to completion on a machine with `gh` available configures vault
      backup without mentioning Pro.

### Migration and resume safety

- [ ] `readOnboardingState()` / `getFirstIncompleteStep()` / `isOnboardingComplete()` behave
      correctly for an **existing** `~/.aigon/onboarding-state.json` that contains a `pro` key.
      Specifically: a state file with `{"steps": {"prereqs":"done","terminal":"done","agents":"done","pro":"skipped"}}`
      must resume at `seed-repo`, not re-run `agents` and not throw.
- [ ] A stale `steps.pro` entry is ignored (or stripped on next write) and never causes
      `isOnboardingComplete()` to return false — it iterates `STEP_IDS`, so verify rather
      than assume.
- [ ] A migration in `lib/migration.js` removes `proKey` from `~/.aigon/config.json`.
      **Coordinate with F693** — if F693 already adds this migration, do not add a second one;
      reference it here instead.
- [ ] `aigon doctor` does not report the wizard as incomplete for users whose state file
      predates the change.

### Downstream surfaces that count steps

- [ ] The wizard's own summary output (`lib/onboarding/wizard.js:143` and the `summary` block
      at ~line 837) lists eight steps.
- [ ] `docker/clean-room/README.md:86` — "**Step 8 (Aigon Pro vault)** — decline" is wrong on
      two counts after this change (vault is step 8 but is no longer Pro; the old step 8 was
      `demo`). Correct it. **Shared file with F694** — whichever lands second reconciles.
- [ ] `docker/clean-room/smoke-test.sh` — any step-count assertion or Pro-key plumbing in the
      unattended path is updated. **Shared file with F694.**
- [ ] `site/content/guides/setup-wizard.mdx` — the documented step list drops the Pro step and
      renumbers. **Shared file with F694.**
- [ ] `--step <id>` / `--resume` flag handling accepts the eight valid ids and rejects `pro`
      with a clear message rather than silently starting from the top.

### Tests

- [ ] There is currently **no test coverage for the wizard at all** (no `tests/**/wizard*` or
      `onboard*` file exists). Add at minimum a unit test for `lib/onboarding/state.js` covering:
      fresh state → first step is `prereqs`; legacy state containing `pro` → resumes at the right
      step; all eight done → `isOnboardingComplete()` is true; state containing only the old
      nine-step set → does not report incomplete forever.
- [ ] `npm run test:core` is green.

## Validation

```bash
# The step is gone from the registry and the wizard
! grep -n "'pro'" lib/onboarding/state.js
! grep -n "isProPackageInstalled\|installProPackage\|AIGON_PRO_KEY\|aigon-pro" lib/onboarding/wizard.js
! grep -n "Vault backup is a Pro feature" lib/onboarding/wizard.js

# Eight steps, in order
node -e "const {STEP_IDS}=require('./lib/onboarding/state');const want=['prereqs','terminal','agents','seed-repo','repos','server','demo','vault'];if(JSON.stringify(STEP_IDS)!==JSON.stringify(want)){console.error('got',STEP_IDS);process.exit(1)}console.log('ok')"

# Legacy state file with a 'pro' entry resumes correctly
node -e "
const s=require('./lib/onboarding/state');
const legacy={steps:{prereqs:'done',terminal:'done',agents:'done',pro:'skipped'}};
const next=s.getFirstIncompleteStep(legacy);
if(next!=='seed-repo'){console.error('resumed at',next);process.exit(1)}
console.log('ok');
"

npm run test:core
```

## Pre-authorised

- May skip npm run test:browser mid-iteration; the deploy gate still runs it before close

## Technical Approach

### Removing a step from an ordered, persisted list is the whole risk

`STEP_IDS` is not just a display list — it is the ordering used by `getFirstIncompleteStep()`
(`STEP_IDS.find(id => !state.steps[id])`) and by `isOnboardingComplete()`
(`STEP_IDS.every(...)`), and the persisted `~/.aigon/onboarding-state.json` on every existing
machine has a `pro` key in `steps`.

Removing `'pro'` from the array is *mostly* safe by construction — both functions iterate
`STEP_IDS`, so an extra key in `state.steps` is simply ignored — but confirm it rather than
assume, and add the tests above. The failure mode to rule out is `shouldRunStep()`
(`lib/onboarding/wizard.js:846`), which does `STEP_IDS.indexOf(stepId)` against
`STEP_IDS.indexOf(startStep)`. If `startStep` is ever `'pro'` (a resume from a state file
written mid-Pro-step), `indexOf` returns `-1` and **every** step compares as "at or after
start", silently re-running the whole wizard. Handle `-1` explicitly.

### Do not renumber by search-and-replace

The `// ── Step N: <id> ──` comments are cosmetic, but there are also user-visible step
numbers in `docker/clean-room/README.md` and `site/content/guides/setup-wizard.mdx`, and
those refer to what the *user sees*. Renumber by reading the wizard top to bottom, not by
regex.

### The vault step is the actual product win here

Removing the Pro step is small. Un-gating vault is the change users feel: backup configuration
has been silently skipped for every OSS user since F236 moved the backup engine to Pro. After
this change `aigon setup` configures vault for everyone, so exercise that path end-to-end on a
real machine with `gh` installed — per the "validate end-to-end with real tools first" rule,
a passing unit test is not evidence the wizard works.

Note the vault step depends on `lib/backup.js`, which **only exists after F693 lands**. Do not
start this feature before F693's engine-vendoring commit is on `main`, or the un-gated vault
step will require a module that isn't there.

### Ordering within the set

F693 → F695 → F694 is the cleanest sequence: the code merge gives `lib/backup.js` a home, the
wizard change settles the step numbering, and the docs feature then documents a stable step
list. F694 and F695 both touch `setup-wizard.mdx`, `docker/clean-room/README.md`, and
`smoke-test.sh` — landing F695 first keeps F694 as the single reconciling pass.

## Dependencies

- **F693** — `lib/backup.js` must exist in OSS before the vault step can require it directly.
  Hard dependency, not just ordering preference.
- **F694** — shares `site/content/guides/setup-wizard.mdx`, `docker/clean-room/README.md`,
  and `docker/clean-room/smoke-test.sh`. F694 lands after this feature and reconciles them.
- Declared in frontmatter: `depends_on: [693]`.

## Out of Scope

- Any other wizard step's behaviour. Only `pro` (removed) and `vault` (un-gated) change.
- Deleting `lib/pro.js` / `lib/commands/pro.js` / the `aigon pro activate` verb — F693 owns
  the gating teardown. This feature only stops the *wizard* from calling into it.
- Rewriting the wizard's prompt copy, adding steps, or changing the `--yes` contract beyond
  dropping `AIGON_PRO_KEY`.
- The docs-site setup-wizard guide's full rewrite — F694 owns the prose; this feature only
  needs the step list to be factually correct.

## Open Questions

- Should `steps.pro` be **actively stripped** from `~/.aigon/onboarding-state.json` on the
  next write, or just ignored? Stripping is tidier and makes the state file self-describing;
  ignoring is zero-risk. Recommend stripping in `writeStepState()` by filtering unknown keys,
  but only if that cannot lose forward-compatibility for a future added step.
- Does `aigon doctor` or the dashboard read `onboarding-state.json` and render a step count
  anywhere? Worth a `grep -rn "onboarding-state\|STEP_IDS" lib/ templates/` before starting.

## Related

- Prior work: F337 (onboarding-wizard — the feature that built this wizard; read its spec for
  the intended step semantics), F485 (pro-activate-command), F693 (the merge), F694 (docs).
- `lib/onboarding/state.js` — `STEP_IDS`, the persisted state contract.
- `lib/onboarding/wizard.js` — steps 4 (pro) and 9 (vault).
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="868" height="132" viewBox="0 0 868 132" role="img" aria-label="Feature dependency graph for feature 695" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-695" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-695)"/><path d="M 244 66 C 377 66, 491 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-695)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-695)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dbeafe" stroke="#2563eb" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#693</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">merge aigon pro into aigo…</text><text x="36" y="90" font-size="12" fill="#475569">in-progress</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#694</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">merge pro docs into oss d…</text><text x="636" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#695</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">remove aigon pro step fro…</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
