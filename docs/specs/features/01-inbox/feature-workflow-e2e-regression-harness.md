---
complexity: medium
set: dashboard-feedback-loop
planning_context: ~/.claude/plans/reflective-giggling-grove.md
depends_on: browser-mcp-integration
---

# Feature: workflow-e2e-regression-harness

## Summary

Add `tests/dashboard-e2e/workflow-e2e.spec.js` that drives the full feature lifecycle in the dashboard UI (create → backlog → in-progress → submitted → closed) and asserts at every transition: DOM (kanban column changed), spec on disk (file moved), engine snapshot (`.aigon/workflows/<id>/snapshot.json` state field), and **real tmux pane content** (capture-pane output matches expected agent prompt fragments). Catches a class of bug current mocked-API tests cannot see — write-path/read-path divergence between dashboard, engine, and tmux session.

## User Stories

- [ ] As an agent, when I make any cross-cutting change to the workflow engine, dashboard, or tmux integration, I can run a single spec that exercises the entire happy-path lifecycle and tells me which layer drifted.
- [ ] As a maintainer, I can opt into a real-agent smoke run (`AIGON_E2E_REAL=1`) that uses a live `cc` session to confirm the harness still reflects reality.
- [ ] As a CI observer, the new spec runs as part of `npm run test:ui` without raising the test budget ceiling.

## Acceptance Criteria

- [ ] `tests/dashboard-e2e/workflow-e2e.spec.js` exists, ≤180 LOC.
- [ ] Spec asserts at five transition boundaries (create, prioritise, start, submitted, close) with the four-layer check (DOM, spec file, snapshot, tmux pane) where applicable.
- [ ] New helpers added to `tests/dashboard-e2e/_helpers.js` (≤50 LOC): `createInboxFeatureViaUI`, `expectSnapshotState`, `expectSpecAt`, `expectTmuxPaneContains` (polling), `expectTmuxPaneIdleAfter`, `tmuxSessionFor`, `readSnapshot`.
- [ ] `MOCK_DELAY=fast npm run test:ui -- workflow-e2e` passes green in <30s.
- [ ] `MOCK_DELAY=fast npm run test:ui` (full suite) passes green and stays under the existing test budget (`bash scripts/check-test-budget.sh` exits 0).
- [ ] `for i in $(seq 1 10); do MOCK_DELAY=fast npm run test:ui -- workflow-e2e || break; done` — 10/10 passes (soak run for tmux-timing flakiness).
- [ ] Gated real-agent test exists (`test.skip(!process.env.AIGON_E2E_REAL, ...)`) and runs ≤30s when invoked with `AIGON_E2E_REAL=1`.
- [ ] No changes to `scripts/check-test-budget.sh` ceiling. If the spec overflows the budget, refactor into helpers — do not raise the ceiling.

## Validation

```bash
node --check tests/dashboard-e2e/workflow-e2e.spec.js
MOCK_DELAY=fast npx playwright test --config tests/dashboard-e2e/playwright.config.js workflow-e2e
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.
- May extend `tests/dashboard-e2e/_helpers.js` by up to 60 LOC if helper composition keeps the spec under 180 LOC.

## Technical Approach

**Spec structure (`workflow-e2e.spec.js`):**

```js
test.describe('Workflow E2E (full lifecycle)', () => {
  test('mock lifecycle: create → backlog → in-progress → submitted → closed', async ({ page }) => {
    await gotoPipelineWithMockedSessions(page);

    // Phase 1 — CREATE (snapshot NOT yet created — engine snapshots only on prioritise)
    const paddedId = await createInboxFeatureViaUI(page, 'wf e2e feature');
    await expectSpecAt(ctx.tmpDir, paddedId, '01-inbox/');

    // Phase 2 — PRIORITISE
    await prioritiseInboxFeature(page, 'wf e2e feature');
    await expectSpecAt(ctx.tmpDir, paddedId, '02-backlog/');
    await expectSnapshotState(ctx.tmpDir, paddedId, 'backlog');

    // Phase 3 — START with cc
    await startFeatureWithAgents(page, 'wf e2e feature', ['cc']);
    await expectSnapshotState(ctx.tmpDir, paddedId, 'implementing');
    const session = tmuxSessionFor(paddedId, 'cc', ctx.tmpDir, 'implement');
    await expectTmuxPaneContains(session, /feature-\d+.*cc/i);

    // Phase 4 — drive MockAgent to submitted
    await new MockAgent({ paddedId, agent: 'cc', role: 'implement', tmpDir: ctx.tmpDir }).run();
    await expectSnapshotState(ctx.tmpDir, paddedId, 'submitted');
    await expectTmuxPaneIdleAfter(session, /implementation complete|submitted/i);

    // Phase 5 — CLOSE (solo skips review)
    await clickCardAction(page, card, 'feature-close', 'feature-close');
    await expectFeatureClosed(page, 'wf e2e feature');
    await expectSpecAt(ctx.tmpDir, paddedId, '04-done/');
    await expectSnapshotState(ctx.tmpDir, paddedId, 'done');
  });

  test.skip(!process.env.AIGON_E2E_REAL, 'real-agent smoke — requires live cc');
  test('real-agent smoke (AIGON_E2E_REAL=1)', async ({ page }) => {
    // create → start cc → assert agent banner appears in pane (no transition assertions)
  });
});
```

Each transition asserts **DOM → spec-on-disk → engine-snapshot → tmux-pane** in that order. A failure points to which layer drifted.

**New `_helpers.js` functions:**

| Helper | Purpose |
| --- | --- |
| `createInboxFeatureViaUI(page, title)` | Drive the dashboard inbox-create modal; CLI fallback if modal absent. Returns padded ID. |
| `expectSnapshotState(repoPath, paddedId, expectedState)` | Read `.aigon/workflows/<id>/snapshot.json`, assert `state` matches. |
| `expectSpecAt(repoPath, paddedId, folder)` | Confirm spec file exists in expected lifecycle folder. |
| `expectTmuxPaneContains(session, regex, timeoutMs=8000)` | Poll `tmux capture-pane -p -t <session> -S -200`; assert regex matches within timeout. |
| `expectTmuxPaneIdleAfter(session, regex, timeoutMs=8000)` | Like above but asserts regex matches the LAST non-empty line (post-action idle prompt). |
| `tmuxSessionFor(paddedId, agentId, repoPath, role)` | Wraps `lib/supervisor.js` session-name builder so the test computes the same name the dashboard supervisor uses. |
| `readSnapshot(repoPath, paddedId)` | Returns parsed snapshot JSON or null. |

**Reuse — do not reimplement:**

- `lib/supervisor.js:243-249` — capture-pane invocation + per-agent idle/working regexes. The new helpers should source these patterns rather than duplicating.
- `lib/workflow-snapshot-adapter.js` — snapshot read API.
- `lib/worktree.js:1273` `createDetachedTmuxSession` — confirms session-name format for `tmuxSessionFor`.
- `tests/dashboard-e2e/failure-modes.spec.js` — model for tmux-attached assertions; already proves the pattern works.
- `tests/dashboard-e2e/solo-lifecycle.spec.js` — UI-driving pattern for create / prioritise / start.
- `tests/integration/mock-agent.js` — MockAgent harness (drives agent transitions deterministically under `MOCK_DELAY=fast`).

**Risks & mitigations:**

1. **tmux-timing flakiness.** `MOCK_DELAY=fast` compresses implementing→submitted to ~600ms — `expectTmuxPaneContains` MUST poll, not single-shot, and assertions MUST target stable prompt fragments (the agent banner, the post-action idle line) rather than transient progress text. Mitigation: copy regex patterns from `lib/supervisor.js:243-249` verbatim, and run the 10× soak before merging.
2. **Test budget.** Suite has headroom (~6,869 LOC against 9,540 ceiling). Aim for ≤230 LOC total addition. If overflowing, refactor into helpers — do NOT raise the ceiling.
3. **Real-agent test stability.** Gated behind `AIGON_E2E_REAL=1` — never runs in default CI. Designed for manual confidence checks, not gating signal.

**Out of band:** the agent implementing this feature should use the freshly-installed Playwright MCP (from `browser-mcp-integration`) to interactively explore the dashboard while authoring helpers. That's the point of sequencing: dogfood Spec 1 while building Spec 2.

## Dependencies

- depends_on: browser-mcp-integration

## Out of Scope

- Review/eval transition assertions (solo path skips them; if needed, add a follow-up `workflow-e2e-fleet` spec).
- Failure recovery scenarios — already covered by `failure-modes.spec.js`.
- Fleet multi-agent flow — already covered by `fleet-lifecycle.spec.js`.
- F397 engine-first lifecycle precedence rules — out-of-band, large enough for its own spec.
- Visual regression baselines (PNG diffing) — this spec asserts via a11y/state, not pixels.

## Open Questions

-

## Related

- Research:
- Set: dashboard-feedback-loop
- Prior features in set: browser-mcp-integration
- Adjacent: `failure-modes.spec.js` (tmux-attach pattern), `solo-lifecycle.spec.js` (UI driver pattern), F430 transcript-tmux-pipe-pane-optin (different concern; this spec does NOT depend on F430).
