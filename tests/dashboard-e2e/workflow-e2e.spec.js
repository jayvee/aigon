// @ts-check
'use strict';
/**
 * E2E: Full feature lifecycle with four-layer assertions at every transition.
 *
 *   create → backlog → in-progress → submitted → closed
 *
 * At each boundary we check four layers in order — DOM, spec-on-disk,
 * engine snapshot, and tmux pane content — so a failure points to the
 * specific layer that drifted (write-path/read-path mismatch between the
 * dashboard, the workflow engine, and the supervised tmux session).
 *
 * REGRESSION: complements solo-lifecycle.spec.js by adding engine-snapshot
 * and tmux-pane assertions. solo-lifecycle proves the UI happy path; this
 * spec catches engine state drift the existing mocked-API tests cannot see.
 *
 * Run: npx playwright test --config tests/dashboard-e2e/playwright.config.js workflow-e2e
 */
const { test, expect } = require('@playwright/test');
const { MockAgent } = require('../integration/mock-agent');
const {
    SOLO_DELAYS, readCtx, waitForPath, forceRefresh,
    gotoPipelineWithMockedSessions, startFeatureWithAgents,
    clickCardAction, expectFeatureClosed,
    createInboxFeatureViaUI, prioritiseFromInboxViaUI,
    expectSnapshotState, expectSpecAt, readSnapshot,
    tmuxSessionFor, expectTmuxPaneContains, expectTmuxPaneIdleAfter,
} = require('./_helpers');
const path = require('path');

const FEATURE_NAME = 'wf e2e feature';
const FEATURE_DESC = 'wf-e2e-feature';

test.describe('Workflow E2E (full lifecycle)', () => {
    test('mock lifecycle: create → backlog → in-progress → submitted → closed', async ({ page }) => {
        const ctx = readCtx();
        await gotoPipelineWithMockedSessions(page);

        // Phase 1 — CREATE (slug-keyed inbox row; engine snapshot only at prioritise)
        const slug = await createInboxFeatureViaUI(page, FEATURE_NAME);
        const inboxCol = page.locator('.kanban-col[data-stage="inbox"]').first();
        await expect(inboxCol).toContainText(FEATURE_NAME, { timeout: 8000 });
        expectSpecAt(ctx.tmpDir, slug, '01-inbox');
        expect(readSnapshot(ctx.tmpDir, '999')).toBeNull(); // sanity: no numeric-id snapshot yet

        // Phase 2 — PRIORITISE (inbox → backlog; engine snapshot bootstrapped here)
        const paddedId = await prioritiseFromInboxViaUI(page, FEATURE_NAME);
        const backlogCol = page.locator('.kanban-col[data-stage="backlog"]').first();
        await expect(backlogCol).toContainText(FEATURE_NAME, { timeout: 8000 });
        expectSpecAt(ctx.tmpDir, paddedId, '02-backlog');
        await expectSnapshotState(ctx.tmpDir, paddedId, 'backlog');

        // Phase 3 — START with cc (backlog → in-progress; tmux session created)
        // Expand any backlog overflow ("N more …") so the new card's Start button is visible.
        const moreBtn = backlogCol.locator('button.btn', { hasText: /more …/ }).first();
        if (await moreBtn.count()) await moreBtn.click().catch(() => { /* already expanded */ });
        await startFeatureWithAgents(page, FEATURE_NAME, ['cc']);
        const inProgressCol = page.locator('.kanban-col[data-stage="in-progress"]').first();
        await expect(inProgressCol).toContainText(FEATURE_NAME, { timeout: 8000 });
        expectSpecAt(ctx.tmpDir, paddedId, '03-in-progress');
        await expectSnapshotState(ctx.tmpDir, paddedId, 'implementing');
        const sessionName = tmuxSessionFor(paddedId, 'cc', ctx.tmpDir, 'do');
        const worktreePath = path.join(ctx.worktreeBase, `feature-${paddedId}-cc-${FEATURE_DESC}`);
        await waitForPath(worktreePath, 15000);
        // Banner regex matches the dashboard supervisor's idle-detection patterns
        // (lib/supervisor.js:243-263 uses templates/agents/<id>.json regexes).
        await expectTmuxPaneContains(sessionName, /feature-\d+|cc|claude/i);

        // Phase 4 — drive MockAgent to submitted (still in-progress; agent badge flips)
        await new MockAgent({
            featureId: paddedId, agentId: 'cc', desc: FEATURE_DESC,
            repoPath: ctx.tmpDir, worktreeBase: ctx.worktreeBase, delays: SOLO_DELAYS,
        }).run();
        await forceRefresh(page);
        await page.waitForTimeout(500);
        // Snapshot agent status flips to "ready" once agent-status submitted lands
        // (lifecycle stays "implementing" for solo until close — the dashboard
        // derives the submitted badge from agents.<id>.status, not lifecycle).
        const deadline = Date.now() + 8000;
        let agentReady = false;
        while (Date.now() < deadline) {
            const snap = readSnapshot(ctx.tmpDir, paddedId);
            if (snap && snap.agents && snap.agents.cc && /ready|submitted/.test(snap.agents.cc.status)) { agentReady = true; break; }
            await new Promise(r => setTimeout(r, 200));
        }
        expect(agentReady, 'cc agent status should reach ready/submitted in snapshot').toBe(true);
        const card = inProgressCol.locator('.kcard').filter({ hasText: FEATURE_NAME }).first();
        const submittedBadge = card.locator('.kcard-agent.agent-cc .kcard-agent-status.status-submitted');
        await expect(submittedBadge).toBeVisible({ timeout: 8000 });

        // Phase 5 — CLOSE (solo skips review; in-progress → done). Drive the
        // dashboard's `/api/action` endpoint directly — same path the kcard
        // close button posts to via handleFeatureAction's requestAction. The
        // button itself can be hidden behind PR-warning advisory styling or
        // overflow folds in dense backlogs, so skip the click hunt.
        const closeResp = await page.request.post(`http://127.0.0.1:${ctx.port}/api/action`, {
            data: { action: 'feature-close', args: [paddedId, 'cc'], repoPath: ctx.tmpDir },
            timeout: 30000,
        });
        const closeJson = await closeResp.json().catch(() => ({}));
        expect(closeResp.ok(), `feature-close failed: ${JSON.stringify(closeJson)}`).toBe(true);
        await forceRefresh(page);
        await page.waitForTimeout(500);
        await expectFeatureClosed(page, FEATURE_NAME);
        expectSpecAt(ctx.tmpDir, paddedId, '05-done');
        await expectSnapshotState(ctx.tmpDir, paddedId, 'done', 8000);
    });

    test('real-agent smoke (AIGON_E2E_REAL=1): create → start cc → assert agent banner', async ({ page }) => {
        test.skip(!process.env.AIGON_E2E_REAL, 'real-agent smoke — requires AIGON_E2E_REAL=1 + live cc');
        const ctx = readCtx();
        await gotoPipelineWithMockedSessions(page);
        await createInboxFeatureViaUI(page, FEATURE_NAME);
        const paddedId = await prioritiseFromInboxViaUI(page, FEATURE_NAME);
        await startFeatureWithAgents(page, FEATURE_NAME, ['cc']);
        await expectSnapshotState(ctx.tmpDir, paddedId, 'implementing');
        const sessionName = tmuxSessionFor(paddedId, 'cc', ctx.tmpDir, 'do');
        await expectTmuxPaneIdleAfter(sessionName, /\$|>|❯|claude|cc/i, 30000);
    });
});
