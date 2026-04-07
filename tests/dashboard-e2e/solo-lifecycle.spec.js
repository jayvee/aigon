// @ts-check
'use strict';

/**
 * E2E: Solo worktree lifecycle via dashboard.
 *
 * inbox → Prioritise → backlog → Start (cc) → in-progress → MockAgent submits
 *  → refresh → Close → done. Solo *worktree* mode (one agent, one worktree).
 *
 * Run: npx playwright test --config tests/dashboard-e2e/playwright.config.js solo-lifecycle
 */

const { test, expect } = require('@playwright/test');
const path = require('path');
const { MockAgent } = require('../integration/mock-agent');
const {
    SOLO_DELAYS,
    readCtx,
    waitForPath,
    forceRefresh,
    gotoPipelineWithMockedSessions,
    prioritiseInboxFeature,
    startFeatureWithAgents,
    clickCardAction,
    expectFeatureClosed,
    expectConsoleHasAction,
} = require('./_helpers');

test.describe('Solo worktree lifecycle', () => {
    test('full solo lifecycle: inbox → prioritise → setup cc → submit → close → done', async ({ page }) => {
        const ctx = readCtx();
        const featureName = 'e2e solo feature';
        const desc = 'e2e-solo-feature';

        await gotoPipelineWithMockedSessions(page);

        // Inbox → Backlog
        const paddedId = await prioritiseInboxFeature(page, featureName);

        // Backlog → In-progress with cc
        await startFeatureWithAgents(page, featureName, ['cc']);

        const inProgressCol = page.locator('.kanban-col[data-stage="in-progress"]').first();
        await expect(inProgressCol).toContainText(featureName, { timeout: 8000 });
        const inProgressCard = inProgressCol.locator('.kcard').filter({ hasText: featureName }).first();
        await expect(inProgressCard.locator('.kcard-agent.agent-cc')).toBeVisible({ timeout: 5000 });

        // MockAgent runs in the worktree
        const worktreePath = path.join(ctx.worktreeBase, `feature-${paddedId}-cc-${desc}`);
        await waitForPath(worktreePath, 15000);
        const agent = new MockAgent({
            featureId: paddedId,
            agentId: 'cc',
            desc,
            repoPath: ctx.tmpDir,
            worktreeBase: ctx.worktreeBase,
            delays: SOLO_DELAYS,
        });
        await agent.run();

        await forceRefresh(page);
        await page.waitForTimeout(500);

        // Submitted state
        const submittedBadge = inProgressCard.locator('.kcard-agent.agent-cc .kcard-agent-status.status-submitted');
        await expect(submittedBadge).toBeVisible({ timeout: 8000 });

        // Solo mode: no eval action, only close
        const evalBtn = inProgressCard.locator('.kcard-va-btn[data-va-action="feature-eval"]');
        await expect(evalBtn).toHaveCount(0);

        // Close → done
        await clickCardAction(page, inProgressCard, 'feature-close', 'feature-close');

        await expectFeatureClosed(page, featureName);
        await expectConsoleHasAction(page, 'feature-close');
    });
});
