// @ts-check
'use strict';
/**
 * E2E: Fleet lifecycle via dashboard.
 *
 * backlog → Start (cc + gg) → both implement → both submit →
 * Eval session spawns (mocked launch) → winner written to eval log →
 * Close & Merge cc → done.
 *
 * REGRESSION: winner-pick → close transition in Fleet mode was not covered
 * by any e2e; regressions in feature-eval setup, winner selection, or
 * feature-close(winner) surface here before reaching production.
 *
 * Run: npx playwright test --config tests/dashboard-e2e/playwright.config.js fleet-lifecycle
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { MockAgent } = require('../integration/mock-agent');
const {
    FLEET_CC_DELAYS, FLEET_GG_DELAYS, readCtx, waitForPath, forceRefresh,
    gotoPipelineWithMockedSessions, prioritiseInboxFeature, startFeatureWithAgents,
    expectFeatureClosed,
} = require('./_helpers');

const FEATURE_NAME = 'e2e fleet feature';
const FEATURE_DESC = 'e2e-fleet-feature';

test('full fleet lifecycle: start (cc+gg) → both submit → eval → winner pick → close → done', async ({ page }) => {
    const ctx = readCtx();
    await gotoPipelineWithMockedSessions(page);

    // Feature is already in backlog from global setup — read padded ID from card
    const paddedId = await prioritiseInboxFeature(page, FEATURE_NAME);

    // Start with both cc + gg agents via agent picker
    await startFeatureWithAgents(page, FEATURE_NAME, ['cc', 'gg']);
    const inProgressCol = page.locator('.kanban-col[data-stage="in-progress"]').first();
    await expect(inProgressCol).toContainText(FEATURE_NAME, { timeout: 8000 });
    const ipCard = inProgressCol.locator('.kcard').filter({ hasText: FEATURE_NAME }).first();
    await expect(ipCard.locator('.kcard-agent.agent-cc')).toBeVisible({ timeout: 5000 });
    await expect(ipCard.locator('.kcard-agent.agent-gg')).toBeVisible({ timeout: 5000 });

    // Wait for both worktrees to materialise before running mock agents
    const ccPath = path.join(ctx.worktreeBase, `feature-${paddedId}-cc-${FEATURE_DESC}`);
    const ggPath = path.join(ctx.worktreeBase, `feature-${paddedId}-gg-${FEATURE_DESC}`);
    await waitForPath(ccPath, 20000);
    await waitForPath(ggPath, 20000);

    // Run both mock agents concurrently — staggered so cc finishes first (FLEET_CC < FLEET_GG)
    await Promise.all([
        new MockAgent({ featureId: paddedId, agentId: 'cc', desc: FEATURE_DESC,
            repoPath: ctx.tmpDir, worktreeBase: ctx.worktreeBase, delays: FLEET_CC_DELAYS }).run(),
        new MockAgent({ featureId: paddedId, agentId: 'gg', desc: FEATURE_DESC,
            repoPath: ctx.tmpDir, worktreeBase: ctx.worktreeBase, delays: FLEET_GG_DELAYS }).run(),
    ]);

    await forceRefresh(page);
    await page.waitForTimeout(500);

    // Assert both agents show submitted badges
    await expect(ipCard.locator('.kcard-agent.agent-cc .kcard-agent-status.status-submitted')).toBeVisible({ timeout: 5000 });
    await expect(ipCard.locator('.kcard-agent.agent-gg .kcard-agent-status.status-submitted')).toBeVisible({ timeout: 5000 });

    // Assert feature-eval action is available (both agents ready → fleet eval unlocked)
    const evalBtn = ipCard.locator('.kcard-va-btn[data-va-action="feature-eval"]');
    await expect(evalBtn).toBeVisible({ timeout: 5000 });

    // Trigger eval: agent picker → pick gg as evaluator → setup action fires → session launch mocked
    await evalBtn.click();
    const picker = page.locator('#agent-picker');
    await expect(picker).toBeVisible({ timeout: 5000 });
    await picker.locator('input[value="gg"]').check();
    // Mock feature-open so the eval agent launch does not spawn a real session
    await page.route('**/api/feature-open', route => route.fulfill({ json: { ok: true, message: 'mock eval launch' } }));
    const [setupResp] = await Promise.all([
        page.waitForResponse('**/api/action'),
        page.click('#agent-picker-submit'),
    ]);
    const setupJson = await setupResp.json().catch(() => ({}));
    expect(setupJson.ok, `feature-eval setup failed: ${setupJson.error || setupJson.stderr || ''}`).toBe(true);
    // Eval agent launch goes to /api/feature-open (mocked above)
    await page.waitForResponse('**/api/feature-open');
    await page.waitForTimeout(500);

    // Spec moves to in-evaluation column after eval setup
    const inEvalCol = page.locator('.kanban-col[data-stage="in-evaluation"]').first();
    await forceRefresh(page);
    await expect(inEvalCol).toContainText(FEATURE_NAME, { timeout: 8000 });
    const evalCard = inEvalCol.locator('.kcard').filter({ hasText: FEATURE_NAME }).first();

    // Write winner to eval file — simulates evaluator output that the read model polls for
    const evalFile = path.join(ctx.tmpDir, 'docs', 'specs', 'features', 'evaluations', `feature-${paddedId}-eval.md`);
    const evalContent = fs.readFileSync(evalFile, 'utf8');
    fs.writeFileSync(evalFile, evalContent.replace('(to be determined after review)', 'cc'));

    await forceRefresh(page);
    await page.waitForTimeout(500);

    // Assert dashboard shows pick-winner eval status (read model detected **Winner:** cc)
    // Fleet cards with agent sections render this in .kcard-eval-detail, not .eval-badge
    await expect(evalCard.locator('.kcard-eval-detail')).toContainText('Winner:', { timeout: 5000 });

    // Close: fleet modal → cc pre-selected from eval file → submit
    const closeBtn = evalCard.locator('.kcard-va-btn[data-va-action="feature-close"]');
    await expect(closeBtn).toBeVisible({ timeout: 5000 });
    await closeBtn.click();
    const closeModal = page.locator('#close-modal');
    await expect(closeModal).toBeVisible({ timeout: 5000 });
    await expect(closeModal.locator('input[value="cc"]')).toBeChecked({ timeout: 3000 });

    // feature-close merges worktrees — allow up to 60s for the CLI to complete
    const [closeResp] = await Promise.all([
        page.waitForResponse('**/api/action', { timeout: 60000 }),
        page.click('#close-modal-submit'),
    ]);
    const closeJson = await closeResp.json().catch(() => ({}));
    expect(closeJson.ok, `feature-close failed: ${closeJson.error || closeJson.stderr || ''}`).toBe(true);
    await page.waitForResponse('**/api/refresh', { timeout: 15000 });

    await expectFeatureClosed(page, FEATURE_NAME, ['in-evaluation']);
});
