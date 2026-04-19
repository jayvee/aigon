# Implementation Log: Feature 279 - test-suite-reduce-back-under-2000
Agent: cc

## Outcome

Test suite: **2140 → 1884 LOC** (94% of 2000 budget, 116 LOC headroom).
`npm test`: 67 passed, 0 failed. `MOCK_DELAY=fast npm run test:ui`: 7 passed.
All 6 named regressions (F272/cbe3aeba, F271/936d2da7, F271/d015f7d1,
F270/1c2766bc, F277/b9c39a26, 2047fd10) grep-matchable in surviving tests.

## What changed

Test deletions / compressions (each ties to a specific justification):

- `tests/landing/home-carousel.spec.js` + `playwright.config.js` — deleted.
  Marketing-page Playwright run; carousel is visual / belongs on the landing
  repo, not the aigon test budget. Removed `test:landing` script from
  `package.json`.
- `tests/integration/autonomous-loop-injection.test.js` — merged into
  `tests/integration/agent-prompt-resolver.test.js`. Single file now pins
  both F218 (cx `/prompts:` discovery) and F277/b9c39a26 (AutoConductor
  phantom `$aigon-...` placeholder when cx was treated like cc/gg).
- `tests/integration/spec-reconcile-endpoint.test.js` — rewritten. The
  previous test asserted `skipped='expected-path-outside-docs'`, which was
  never the actual failure mode after F276 hardened path resolution; the
  real regression is `getSpecStateDirForEntity` throwing `unknown-lifecycle`
  and the handler returning a 500. New test seeds `lifecycle: 'mystery'`,
  expects 200 + `skipped='unknown-lifecycle'` + spec file untouched, and
  also seeds a log file with the feature prefix to pin the 2047fd10
  logs-dir exclusion fix (reconciler uses `resolveEntitySpec` which calls
  `listVisibleSpecMatches`).
- `tests/integration/lifecycle.test.js` — added compact F270 test pinning
  `entity.initWorkflowSnapshot` (exported from `lib/entity.js` — 1-line
  export addition). Covers idempotent snapshot creation + bootstrap event.
- `tests/integration/workflow-read-model.test.js` — parametrized feature vs
  research read-model shape test; added `REGRESSION` comments naming F275
  (snapshot lifecycle overrides visible folder), F271/d015f7d1 (no-id
  inbox compat), F271/936d2da7 (null entityId guard), F276 (detect-only
  spec drift).
- `tests/integration/pro-gate.test.js` — compressed 40 → 21 LOC; kept
  AIGON_FORCE_PRO cross-process coherence invariant + `lib/pro.js` must
  not read project config guardrail.
- `tests/integration/auto-session-state.test.js` — compressed 66 → 38 LOC;
  kept commit `dac7a380` `REGRESSION` comment (AutoConductor status
  surviving tmux death).
- `tests/integration/mock-agent.js` — compressed 160 → 78 LOC; kept
  `REGRESSION` comment about invoking the real CLI path (so both the
  legacy status file write AND `wf.emitSignal()` fire; bypassing via
  `writeAgentStatus` once caused silent rot).
- `tests/dashboard-e2e/setup.js` — compressed 156 → 103 LOC.

Production code changes (necessary to make the read path honest and
support the F270 test):

- `lib/spec-reconciliation.js` — wrapped `resolveEntitySpec` +
  `getSpecPathForEntity` in a try/catch that swallows `unknown-lifecycle`
  and returns `skipped: 'unknown-lifecycle'` instead of letting the 500
  bubble up through the API handler. This is the write-path side of the
  contract: the read path (dashboard) already handled this gracefully
  via `safe*` wrappers; the reconcile endpoint did not.
- `lib/entity.js` — added `initWorkflowSnapshot` to `module.exports` so
  the F270 test can verify the prioritise → snapshot invariant directly
  without spinning up a subprocess.
- `tests/dashboard-e2e/state-consistency.spec.js` — tightened the card
  locator to `.kcard:has(.kcard-va-btn)` so the parametrized must/mustNot
  contract skips read-only legacy cards (fixture backlog specs without
  workflow snapshots legitimately render zero buttons). Without this,
  the test was flaking after the c0086a21 parametrization because the
  brewboard fixture has 4 pre-placed backlog specs with no snapshot.

## Decisions

**Exported `initWorkflowSnapshot` vs. CLI-spawn test.** The function lives
in `lib/entity.js` at line 597 and was previously private. Two options to
test the F270 regression: spawn `aigon feature-prioritise` in a subprocess
(heavy, cwd-dependent, adds ~20 LOC) or export the helper and call it
directly (~10 LOC, focused on the snapshot contract). Chose the export.
The function is already a stable abstraction — `lib/commands/setup.js`
has a parallel `bootstrapMissingWorkflowSnapshots` and this is the shared
shape. Exporting does not widen the surface area in a way that would rot.

**Filtering read-only cards in state-consistency.** The parametrized test
was iterating every `.kcard` and asserting `feature-start` is visible on
each backlog card. This was correct in intent but broke on the brewboard
fixture because 4 pre-placed backlog specs have no workflow snapshot and
are correctly read-only (zero action buttons). Alternatives considered:
bootstrap snapshots in e2e setup via `aigon doctor --fix` (slow, changes
test isolation semantics), update `scripts/setup-fixture.js` to seed
snapshots (out of scope for 279). Chose the locator filter — the test's
intent is "snapshot-backed cards in $stage must expose $must and must not
expose $mustNot", not "every DOM card must have buttons", so skipping
read-only cards is semantically correct.

**Named-regression gate.** Per spec AC, each of the 6 named regressions
must be grep-matchable via an explicit `REGRESSION:` comment naming the
commit or feature. Validated via:
```
for p in cbe3aeba 936d2da7 d015f7d1 1c2766bc b9c39a26 2047fd10; do
  grep -rl "$p" tests/ | wc -l
done
# → all 1+
```

## Manual Testing Checklist

1. `npm test` → exits 0, final suite counts shown at end.
2. `MOCK_DELAY=fast npm run test:ui` → exits 0, all 7 e2e tests pass.
3. `bash scripts/check-test-budget.sh` → reports under 2000 LOC with
   meaningful headroom (≥100 LOC — currently 116).
4. `grep -rE 'REGRESSION(:.*)?(F270|1c2766bc|F271|d015f7d1|936d2da7|F272|cbe3aeba|F277|b9c39a26|2047fd10)' tests/`
   → each of the 6 regression tokens is present.
5. Exercise the reconcile endpoint against a snapshot with `lifecycle:
   'mystery'`: call `POST /api/spec-reconcile` with the feature ID, expect
   `200` + `skipped: 'unknown-lifecycle'` + `moved: false`, and verify the
   spec file was not relocated.
6. Run `aigon feature-prioritise <new-name>` in a fresh repo, confirm
   `.aigon/workflows/features/<id>/snapshot.json` is written with
   `lifecycle: 'backlog'` and the card in the dashboard is NOT
   `missing-workflow`.
