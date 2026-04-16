// @ts-check
'use strict';

const { test, expect } = require('@playwright/test');
const { gotoPipelineWithMockedSessions } = require('./_helpers');

test.describe('Done overflow folder opener', () => {
    test('clicking overflow button sends open-folder request for done specs path', async ({ page }) => {
        await gotoPipelineWithMockedSessions(page);

        const doneCol = page.locator('.kanban-col[data-stage="done"]').first();
        await expect(doneCol).toBeVisible({ timeout: 10000 });

        const moreBtn = doneCol.locator('button.btn').filter({ hasText: 'more — open in Finder' }).first();
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
