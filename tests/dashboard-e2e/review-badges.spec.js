// @ts-check
'use strict';
/** F344 STATE_RENDER_META badges + F355 xterm peek cutover. Run: npx playwright test … review-badges */
const { test, expect } = require('@playwright/test');
const { readCtx, gotoPipelineWithMockedSessions } = require('./_helpers');
test('old specReview badge helpers absent; kcard-cycle-history CSS present', async ({ page }) => {
    const ctx = readCtx();
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));
    await gotoPipelineWithMockedSessions(page, ctx, []);
    await page.waitForSelector('.kcard', { timeout: 10000 });

    const oldHelpersExist = await page.evaluate(() => typeof buildSpecReviewBadgeHtml !== 'undefined' || typeof buildSpecCheckBadgeHtml !== 'undefined').catch(() => false);
    expect(oldHelpersExist).toBe(false);

    // kcard-cycle-history CSS must be present (from STATE_RENDER_META badge work)
    const hasCycleCss = await page.evaluate(() => {
        for (const sheet of document.styleSheets) {
            try { for (const r of sheet.cssRules) { if (r.selectorText && r.selectorText.includes('kcard-cycle-history')) return true; } } catch (_) {}
        }
        return false;
    });
    expect(hasCycleCss).toBe(true);

    // No JS errors from new rendering code
    expect(pageErrors.filter(e => e.includes('stateRenderMeta') || e.includes('reviewCycles'))).toHaveLength(0);

    // Kanban cards render (confirms buildKanbanCard + buildAgentStatusHtml work)
    await expect(page.locator('.kcard').first()).toBeAttached();

    expect(await page.evaluate(() => [Terminal,FitAddon,WebglAddon,Unicode11Addon,WebLinksAddon].every(x => typeof x !== 'undefined') && typeof openPeekPanel === 'undefined' && getComputedStyle(document.documentElement).getPropertyValue('--term-bg').trim() !== ''), 'F355').toBe(true);
    await page.screenshot({ path: 'tests/dashboard-e2e/screenshots/terminal-addons-dark.png' });
});
