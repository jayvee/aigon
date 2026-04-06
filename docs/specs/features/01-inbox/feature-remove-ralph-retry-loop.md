# Feature: remove-ralph-retry-loop

## Summary
Delete the Ralph retry loop (`feature-do --autonomous` / `--ralph`) entirely. The codebase has two distinct autonomous modes — `feature-autonomous-start` (AutoConductor: horizontal lifecycle orchestration) and `feature-do --autonomous` (Ralph: vertical retry-until-tests-pass) — and users can't tell them apart from the names. Both say "autonomous," both live under "feature," and neither documents the difference in `aigon --help`. Ralph is also CLI-only (no dashboard path), so most dashboard-primary users never discover it. Rather than paper over the confusion by renaming the flag, delete Ralph entirely now. If retry-until-passing behavior is needed later, it can be reintroduced as part of AutoConductor (via a future feature implementing Answer B from the 2026-04-07 product discussion: merge retry logic into `feature-autonomous-start` as a `--retry-until-passing` option). Git history preserves the current Ralph implementation for anyone who wants to reference it during that future work.

## Safety principle (non-negotiable)

**This deletion must not affect any non-Ralph behavior.** `feature-autonomous-start`, `feature-do` without `--autonomous`, every interactive command, the entire dashboard surface, and the workflow engine are untouched. The only behavioral change is that `aigon feature-do <id> --autonomous` and `aigon feature-do <id> --ralph` now error out with a clear "this flag was removed" message. Every existing test must pass without modification to its assertion logic; tests that exercise Ralph get deleted, not retargeted.

## Motivation — the 2026-04-07 discussion

During feature 222's scoping discussion, I was asked "how is the Ralph loop invoked from the dashboard?" Honest answer: **it isn't**. Ralph is CLI-only. The dashboard's "Start Autonomously" modal wires to `feature-autonomous-start`, not `feature-do --autonomous`. Both commands have "autonomous" in the name, neither `aigon --help` nor the README makes the distinction clear, and most users are dashboard-primary so Ralph is effectively invisible to them.

The cleaner product story is one autonomous mode, well-explained. The user's decision: delete Ralph now, reintroduce retry-until-passing later as part of AutoConductor **only if** usage data or user requests show it's needed.

## User Stories

- [ ] As a new user reading `aigon --help`, I see exactly one "autonomous" concept (`feature-autonomous-start`) with a clear description, not two overlapping commands
- [ ] As an existing user who ran `aigon feature-do 42 --autonomous` before, I get a clear one-line error explaining the flag was removed and pointing at `feature-autonomous-start` if I wanted unattended orchestration
- [ ] As a maintainer, `lib/validation.js` no longer carries the ~300-line Ralph retry loop that nobody's using; code search for "autonomous" returns exactly one mental model
- [ ] As a future implementer who decides retry-until-passing belongs in AutoConductor, I can `git log --all -- lib/validation.js` to find the original Ralph implementation and port the useful parts forward

## Acceptance Criteria

### Core deletion

- [ ] **AC1** — `lib/validation.js:runRalphCommand()` and all its helpers (iteration loop, progress-file tracking, validation command runner, Ralph-specific prompt building) are deleted. Any shared validation helpers that are genuinely reused by non-Ralph code (e.g. by `feature-submit` or other commands) stay — audit carefully before deleting.
- [ ] **AC2** — `lib/commands/feature.js` dispatch path `if (ralphRequested) return runRalphCommand(args)` at ~L1060 is deleted. The `--autonomous` / `--ralph` flag check itself is replaced with a hard error: "The --autonomous flag for feature-do was removed on 2026-04-07. For unattended orchestration, use: aigon feature-autonomous-start <id> <agents...>"
- [ ] **AC3** — `lib/templates.js:278` removes `[--autonomous] [--max-iterations=N] [--auto-submit] [--no-auto-submit]` from the `feature-do` argHints
- [ ] **AC4** — `lib/config.js:148-156` removes the `hasRalph` branch and any Ralph-specific config surfacing
- [ ] **AC5** — Config keys `autonomous.validationCommand`, `autonomous.maxIterations`, `ralph.validationCommand`, `ralph.maxIterations` are deprecated and no longer read anywhere. Existing project configs that still contain these keys are left alone (don't auto-rewrite); they just become no-ops
- [ ] **AC6** — `lib/board.js:259,414` references to `feature-{id}-ralph-progress.md` are removed (the board feature tracker for Ralph progress)
- [ ] **AC7** — `templates/prompts/ralph-iteration.txt` is deleted

### Help + docs cleanup

- [ ] **AC8** — `aigon feature-do --help` (or however it's surfaced) no longer mentions `--autonomous`, `--ralph`, `--max-iterations`, `--auto-submit`, or `--no-auto-submit`
- [ ] **AC9** — `templates/docs/development_workflow.md` removes any reference to Ralph or the retry loop
- [ ] **AC10** — `templates/generic/commands/feature-now.md` removes any reference to Ralph if present
- [ ] **AC11** — `README.md` removes any Ralph mention (audit, likely none but verify)
- [ ] **AC12** — `CLAUDE.md` Common Agent Mistakes section and anywhere else it mentions Ralph is updated
- [ ] **AC13** — Site content under `site/` is audited; if any page mentions Ralph, it's either updated or the mismatch is flagged for a site-repo follow-up

### Test-suite cleanup

- [ ] **AC14** — Any existing test that exercises `runRalphCommand` or `feature-do --autonomous` is **deleted**, not rewritten. Those tests are proving behavior of a feature that no longer exists.
- [ ] **AC15** — The full pre-push check passes after deletion: `npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh`. Budget delta is **negative** (test LOC shrinks) — confirm the new count is still under the 2000 ceiling.

### Error message for removed flag

- [ ] **AC16** — Running `aigon feature-do <id> --autonomous` prints (to stderr):
    ```
    ❌ --autonomous was removed on 2026-04-07.
       For unattended orchestration, use:
         aigon feature-autonomous-start <id> <agent>
    ```
    Then exits with `process.exitCode = 1`. Same message for `--ralph`.
- [ ] **AC17** — This error message is the ONLY place the word "Ralph" appears in the public CLI after deletion (so users Googling old docs find the deprecation note and redirect instructions).

### Update feature 222's spec

- [ ] **AC18** — `docs/specs/features/02-backlog/feature-222-pro-gate-ralph-and-autopilot.md` is renamed and rewritten to reflect the reduced scope. Options:
    1. Rename to `feature-222-pro-gate-research-autopilot.md` (just the research gate remains)
    2. OR keep the ID and update the spec in place to drop all Ralph gate ACs, keeping only research-autopilot
    Either way, the Ralph gate ACs (AC1, AC2 of current 222 spec) are removed. Note in 222's spec that Ralph was deleted in this feature.
- [ ] **AC19** — Feature 222's dependency on this feature is recorded — 222 cannot be implemented until this deletion lands (otherwise 222 would try to gate a command that no longer exists).

## Validation

```bash
# Syntax
node -c aigon-cli.js
node -c lib/validation.js
node -c lib/commands/feature.js
node -c lib/config.js
node -c lib/board.js
node -c lib/templates.js

# Test suite
npm test
MOCK_DELAY=fast npm run test:ui
bash scripts/check-test-budget.sh

# Grep verification — no Ralph references remain in non-error-message paths
grep -rn "runRalphCommand\|ralph-iteration\|ralph-progress" lib/ templates/ || echo "✓ clean"
grep -rn "Ralph\|ralph" lib/ templates/ docs/ CLAUDE.md README.md 2>&1 | grep -v "docs/specs/features/logs/" | grep -v "docs/specs/features/05-done/" | grep -v "removed on 2026-04-07"
# Expected: only the deprecation error-message references and historical log/spec archives

# Manual smoke — confirm the deprecation error fires
aigon feature-do 1 --autonomous
# Expected: ❌ --autonomous was removed... exit 1

aigon feature-do 1 --ralph
# Expected: same error

aigon feature-do 1                        # normal interactive mode — works unchanged
aigon feature-autonomous-start 1 cc       # AutoConductor — works unchanged
```

## Technical Approach

### What gets deleted, specifically

**Files deleted:**
- `templates/prompts/ralph-iteration.txt`

**Files modified:**

1. **`lib/validation.js`** (~1,059 lines, deletion removes ~300-400 lines):
   - `runRalphCommand()` — the main entry point
   - Ralph iteration loop (validation command runner, retry counter, progress file writer)
   - Ralph-specific prompt builder (reads `ralph-iteration.txt` template)
   - Any helper that's exclusively used by the above
   - **Keep**: any validation helper that's used by non-Ralph code (audit required — likely `runValidationCommand` or similar, since `feature-submit` might use it)

2. **`lib/commands/feature.js`** (~L1057-1063):
   ```js
   // BEFORE
   'feature-do': (args) => {
       const options = parseCliOptions(args);
       const id = options._[0];
       const ralphRequested = getOptionValue(options, 'autonomous') || getOptionValue(options, 'ralph');
       if (ralphRequested) {
           return runRalphCommand(args);
       }
       // …
   ```

   ```js
   // AFTER
   'feature-do': (args) => {
       const options = parseCliOptions(args);
       const id = options._[0];
       const ralphRequested = getOptionValue(options, 'autonomous') || getOptionValue(options, 'ralph');
       if (ralphRequested) {
           console.error('❌ --autonomous was removed on 2026-04-07.');
           console.error('   For unattended orchestration, use:');
           console.error('     aigon feature-autonomous-start <id> <agent>');
           process.exitCode = 1;
           return;
       }
       // …
   ```

3. **`lib/templates.js:278`**:
   ```js
   // BEFORE
   'feature-do': { aliases: ['afd'], argHints: '<ID> [--agent=<cc|gg|cx|cu>] [--autonomous] [--max-iterations=N] [--auto-submit] [--no-auto-submit] [--dry-run]' },
   // AFTER
   'feature-do': { aliases: ['afd'], argHints: '<ID> [--agent=<cc|gg|cx|cu>] [--dry-run]' },
   ```

4. **`lib/config.js:148-156`**:
   ```js
   // BEFORE
   const hasRalph = commandName === 'feature-do';
   // (plus whatever reads `projectConfig?.autonomous?.validationCommand || projectConfig?.ralph?.validationCommand`)
   ```
   Delete both the flag and the config-key readers. Project config keys become silent no-ops.

5. **`lib/board.js:259,414`**: remove the two `feature-{id}-ralph-progress.md` file references.

6. **`templates/docs/development_workflow.md`**: audit and remove any Ralph references.

7. **`templates/generic/commands/feature-now.md`**: audit.

8. **`CLAUDE.md`**: the Common Agent Mistakes section currently says `--autonomous` is a common mistake to invent. Remove or rewrite — after this deletion, `--autonomous` is still an invalid arg, just for a different reason.

9. **Feature 222's spec** (`docs/specs/features/02-backlog/feature-222-pro-gate-ralph-and-autopilot.md`): per AC18.

**Tests removed:**
- Audit `tests/` for any Ralph-related test. Likely zero — Ralph was introduced before the current test discipline — but verify.

### Audit checklist (to do BEFORE writing code)

Before any deletion, run this grep pass and list every hit:

```bash
grep -rn "runRalphCommand\|ralph-iteration\|ralph-progress\|hasRalph\|\\-\\-ralph\b" lib/ templates/ docs/ tests/ CLAUDE.md README.md site/
```

Each hit must be classified as:
- **Delete**: the whole line/block goes
- **Rewrite**: stays but loses the Ralph reference
- **Keep**: it's a historical reference (spec logs, closed features) that should NOT be touched

Historical spec logs in `docs/specs/features/logs/` and `05-done/` must NOT be edited — those are historical records.

### What is NOT changing

- `feature-autonomous-start` and AutoConductor — **completely untouched**
- `feature-do` without `--autonomous` — **unchanged**; the interactive path is the primary use case
- `feature-eval`, `feature-review`, `feature-close`, `feature-submit` — unchanged
- `research-*` commands — unchanged
- The dashboard — **zero surface area impact** (Ralph was CLI-only)
- Workflow engine — unchanged
- `lib/pro.js` / `lib/pro-bridge.js` — unchanged; Pro gating is orthogonal
- Existing project configs containing `autonomous.validationCommand` or `ralph.maxIterations` — left in place as silent no-ops; not auto-rewritten

### Explicit non-goal: reintroduction

**This feature deletes Ralph. It does NOT reintroduce retry-until-passing behavior into AutoConductor.** That's a future feature (call it "feature-autonomous-start-retry-until-passing" or fold into feature 159's successor work) if and when usage data or user requests indicate it's needed.

The user's explicit plan (2026-04-07):
> "i am thinking of C for now, and then re-introduce the ralph loop is required later as a part of the autonomous mode (answer B)."

If/when that reintroduction happens, the implementer should:
1. `git log --all -- lib/validation.js templates/prompts/ralph-iteration.txt` to find Ralph's original implementation
2. Port the validation-retry logic into AutoConductor's run loop (in `lib/commands/feature.js:__run-loop`) as a new `--retry-until-passing` option on `feature-autonomous-start`
3. NOT restore `feature-do --autonomous` — the merged behavior lives under `feature-autonomous-start`

## Dependencies

- None — pure deletion. Depends only on the pre-push test discipline (CLAUDE.md rule T1) to stay safe.

## Out of Scope

- Reintroducing retry-until-passing in any form (explicitly deferred — see "Explicit non-goal" above)
- Refactoring `lib/validation.js` beyond what's needed to remove Ralph cleanly
- Renaming `feature-autonomous-start` (out of scope; it's already the only autonomous command that survives this deletion)
- Updating the marketing site `aigon.build/pro` — handled in feature 159's honest-messaging audit
- Removing other CLI flags that might also be unused — audit for dead flags is a separate concern
- Auto-migration of existing project configs that contain Ralph keys — they become no-ops, not errors
- Updating external consumers who might have scripts calling `aigon feature-do --autonomous` — they'll see the deprecation error and can migrate themselves

## Open Questions

None. All design decisions made inline.

## Related

- **2026-04-07 product discussion** (with jayvee): the three-option analysis (A rename, B merge, C delete). User picked C with a future B as a fallback if usage data demands it.
- **Feature 221** (`pro-gate-infrastructure`, shipped) — the sibling autonomous command (`feature-autonomous-start`) that survives this deletion
- **Feature 222** (`pro-gate-ralph-and-autopilot`, backlog) — scope reduces per AC18. Either renamed or rewritten in place to cover only `research-autopilot` gating.
- **Feature 159** (`pro-autonomy-bundle`, in progress) — the honest-messaging cleanup. After this deletion, 159's "add `[Pro]` markers to `--help`" AC has one fewer command to mark (`feature-do --autonomous` is gone entirely).
- **Potential future feature**: `feature-autonomous-start-retry-until-passing` — Answer B, implemented if/when needed. Not queued; no spec yet.
- **CLAUDE.md Rule T1** (pre-push tests) — enforced
- **CLAUDE.md Rule T2** (new code ships with a test) — this feature REMOVES code and tests, so T2 doesn't apply in the usual direction; the commit message should call this out
- **CLAUDE.md Rule T3** (test suite ceiling) — deletion moves LOC count DOWN, reducing pressure on the 2000 ceiling
