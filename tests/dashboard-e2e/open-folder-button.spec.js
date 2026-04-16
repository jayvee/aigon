// @ts-check
'use strict';

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { gotoPipelineWithMockedSessions, readCtx } = require('./_helpers');

function seedDoneOverflowSpecs() {
    const { tmpDir } = readCtx();
    const doneDir = path.join(tmpDir, 'docs', 'specs', 'features', '05-done');
    fs.mkdirSync(doneDir, { recursive: true });
    for (let i = 0; i < 8; i += 1) {
        const id = 900 + i;
        const filePath = path.join(doneDir, `feature-${id}-e2e-open-folder-overflow-${i + 1}.md`);
        if (fs.existsSync(filePath)) continue;
        const content = [
            '---',
            `id: ${id}`,
            `title: e2e open-folder overflow ${i + 1}`,
            '---',
            '',
            '# e2e open-folder overflow',
            '',
            'Seed data for dashboard e2e overflow button test.',
            '',
        ].join('\n');
        fs.writeFileSync(filePath, content, 'utf8');
    }
}

test.describe('Done overflow folder opener', () => {
    test('clicking overflow button sends open-folder request for done specs path', async ({ page }) => {
        seedDoneOverflowSpecs();
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
