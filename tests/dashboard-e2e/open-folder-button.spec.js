// @ts-check
'use strict';

const { test, expect } = require('@playwright/test');
const { gotoPipelineWithMockedSessions } = require('./_helpers');

test.describe('Done overflow folder opener', () => {
    test('clicking overflow button sends open-folder request for done specs path', async ({ page }) => {
        await gotoPipelineWithMockedSessions(page);

        await page.evaluate(() => {
            const store = Alpine.store('dashboard');
            const repos = (store && store.data && Array.isArray(store.data.repos)) ? store.data.repos : [];
            if (!repos.length) return;
            const firstRepo = { ...repos[0] };
            firstRepo.features = Array.from({ length: 8 }).map((_, idx) => ({
                id: String(1000 + idx),
                name: `e2e-open-folder-${idx + 1}`,
                stage: 'done',
                validActions: [],
                createdAt: '2026-04-01T00:00:00.000Z',
                updatedAt: '2026-04-01T00:00:00.000Z'
            }));
            firstRepo.doneTotal = firstRepo.features.length;
            store.pipelineType = 'features';
            store.data = { ...store.data, repos: [firstRepo] };
        });

        const moreBtn = page.locator('button.btn').filter({ hasText: 'more — open in Finder' }).first();
        await expect(moreBtn).toBeVisible({ timeout: 10000 });

        let requestPayload = null;
        await page.route('**/api/open-folder', async route => {
            requestPayload = JSON.parse(route.request().postData() || '{}');
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ ok: true }),
            });
        });

        await moreBtn.click();

        await expect.poll(() => requestPayload && requestPayload.path).toContain('/docs/specs/features/05-done');
    });
});
