// @ts-check
'use strict';

/**
 * F525 regression: the optimistic stage move on feature-start / research-start
 * must re-render the kanban DOM, not just mutate the Alpine store. Before the
 * fix, mutating `entity.stage` alone did not invalidate downstream column
 * x-effects whose last execution had not iterated the moved item — so the
 * card sat in BACKLOG for the full ~20s CLI window. The fix bumps
 * `repo[entityKey]` array identity to fire Alpine's set-trap.
 */

const { test, expect } = require('@playwright/test');
const { gotoPipelineWithMockedSessions } = require('./_helpers');

const FEATURE_SLUG = 'e2e-solo-feature';
const FEATURE_NAME = 'e2e solo feature';

async function columnRepoPath(card) {
    const repoPath = await card.evaluate(el => {
        const col = el.closest('.kanban-col');
        return col && col.getAttribute('data-repo-path');
    });
    expect(repoPath, 'kcard should sit under .kanban-col[data-repo-path]').toBeTruthy();
    return /** @type {string} */ (repoPath);
}

/** One repo's column — disambiguates All Repos when two workspaces reuse the same feature title. */
function kanbanCol(page, stage, repoPath) {
    const esc = String(repoPath).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return page.locator(`div.kanban-col[data-stage="${stage}"][data-repo-path="${esc}"]`);
}

async function findBacklogCard(page) {
    const backlogCol = page.locator('.kanban-col[data-stage="backlog"]').first();
    const card = backlogCol.locator(`.kcard[data-feature-name="${FEATURE_SLUG}"]`).first();
    await expect(card).toBeVisible({ timeout: 8000 });
    return card;
}

async function openAgentPicker(page, card) {
    await card.scrollIntoViewIfNeeded();
    const startBtn = card.locator('.kcard-va-btn[data-va-action="feature-start"]');
    await startBtn.click();
    const picker = page.locator('#agent-picker');
    await expect(picker).toBeVisible({ timeout: 5000 });
    await picker.locator('input[value="cc"]').check();
}

test.describe('F525 optimistic feature-start re-renders kanban', () => {
    test('card jumps to IN-PROGRESS within 250ms of click @smoke', async ({ page }) => {
        await gotoPipelineWithMockedSessions(page);

        // Delay both /api/action and /api/refresh so the optimistic move is the
        // only thing that can re-render before our assertion fires.
        await page.route('**/api/action', async route => {
            await new Promise(r => setTimeout(r, 1500));
            route.fulfill({ json: { ok: true, command: 'feature-start', exitCode: 0, stderr: '' } });
        });
        await page.route('**/api/refresh', async route => {
            await new Promise(r => setTimeout(r, 1500));
            route.fulfill({ json: { repos: [], summary: {}, generatedAt: new Date().toISOString() } });
        });

        const card = await findBacklogCard(page);
        const repoPath = await columnRepoPath(card);
        await openAgentPicker(page, card);

        const clickStart = Date.now();
        await page.click('#agent-picker-submit');

        const inProgressCard = kanbanCol(page, 'in-progress', repoPath).locator(`.kcard[data-feature-name="${FEATURE_SLUG}"]`);
        await expect(inProgressCard).toBeVisible({ timeout: 250 });
        const elapsed = Date.now() - clickStart;
        expect(elapsed, `card moved in ${elapsed}ms`).toBeLessThan(500);
    });

    test('HTTP error rolls back card to backlog', async ({ page }) => {
        await gotoPipelineWithMockedSessions(page);

        await page.route('**/api/action', async route => {
            await new Promise(r => setTimeout(r, 200));
            route.fulfill({ status: 500, json: { error: 'simulated start failure' } });
        });
        // Refresh shouldn't fire on the error branch; mock defensively in case.
        await page.route('**/api/refresh', route => {
            route.fulfill({ json: { repos: [], summary: {}, generatedAt: new Date().toISOString() } });
        });

        const card = await findBacklogCard(page);
        const repoPath = await columnRepoPath(card);
        await openAgentPicker(page, card);
        await page.click('#agent-picker-submit');

        // First: optimistic move puts it in in-progress.
        const inProgressCard = kanbanCol(page, 'in-progress', repoPath).locator(`.kcard[data-feature-name="${FEATURE_SLUG}"]`);
        await expect(inProgressCard).toBeVisible({ timeout: 500 });

        // Then: after the 500 response + rollback, it should be back in backlog.
        const backlogCard = kanbanCol(page, 'backlog', repoPath).locator(`.kcard[data-feature-name="${FEATURE_SLUG}"]`);
        await expect(backlogCard).toBeVisible({ timeout: 3000 });
        await expect(kanbanCol(page, 'in-progress', repoPath).locator(`.kcard[data-feature-name="${FEATURE_SLUG}"]`)).toHaveCount(0);
    });
});
