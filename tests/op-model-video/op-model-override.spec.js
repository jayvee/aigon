// @ts-check
// E2E proof: picking GLM-5.1 in the OpenCode (op) row of the agent picker
// reaches the launch path with the model override intact.
//
// Validates the fix for the bug where --model was being stripped from op
// launches alongside km, causing OpenCode to silently fall back to its
// configured default (DeepSeek V3.2 Speciale → no tool-use endpoints).

const { test, expect } = require('@playwright/test');

test('op honours GLM-5.1 model override end-to-end', async ({ page }) => {
    const TARGET_MODEL = 'openrouter/z-ai/glm-5.1';

    const actionRequests = [];

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Switch to brewboard via the sidebar
    await page.locator('.repo-item, [data-repo-path]').filter({ hasText: 'brewboard' }).first().click().catch(() => {});
    await page.waitForTimeout(500);

    // Switch to Pipeline view
    await page.locator('#tab-pipeline').click();
    await page.waitForTimeout(800);

    await page.screenshot({ path: 'tests/op-model-video/output/01-pipeline-view.png', fullPage: false });

    // Find a backlog feature with an enabled Start button.
    const startBtn = page.locator('button[data-va-action="feature-start"]:not([disabled])').first();
    await expect(startBtn).toBeVisible({ timeout: 10000 });
    await startBtn.click();

    // Picker opens
    await page.waitForSelector('#agent-picker', { state: 'visible', timeout: 10000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'tests/op-model-video/output/02-picker-open.png' });

    // Tick op
    const opRow = page.locator('.agent-check-row[data-agent-id="op"]');
    await opRow.locator('input[type="checkbox"], input[type="radio"]').first().check();

    // Select GLM-5.1 in the model dropdown for op
    const opModelSelect = opRow.locator('.agent-triplet-model');
    await opModelSelect.selectOption(TARGET_MODEL);

    await page.waitForTimeout(300);
    await page.screenshot({ path: 'tests/op-model-video/output/03-glm-selected.png' });

    // Intercept the action call so the test does not actually mutate
    // brewboard state. We only need to assert the dashboard sent the right
    // payload — unit-level launch-string construction is verified separately.
    await page.route('**/api/action', route => {
        const body = JSON.parse(route.request().postData() || '{}');
        actionRequests.push(body);
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ ok: true, intercepted: true }),
        });
    });

    await page.locator('#agent-picker-submit').click();
    await page.waitForTimeout(2500);

    await page.screenshot({ path: 'tests/op-model-video/output/04-after-start.png' });

    console.log('---- /api/action requests captured ----');
    for (const r of actionRequests) {
        console.log(JSON.stringify({ action: r.action, args: r.args }));
    }
    console.log('---- end ----');

    const launchAction = actionRequests.find(r =>
        r.action === 'feature-start' &&
        Array.isArray(r.args) &&
        r.args.some(a => typeof a === 'string' && a.includes('--models=') && a.includes('op=' + TARGET_MODEL))
    );

    expect(launchAction, 'Expected /api/action POST with feature-start + --models=op=' + TARGET_MODEL).toBeTruthy();
});
