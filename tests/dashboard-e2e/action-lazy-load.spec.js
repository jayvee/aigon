// @ts-check
'use strict';
/**
 * E2E: lazy-load action modules — close.js fetched only after Close click.
 * REGRESSION: F519 dynamic import() must not prefetch modal modules on page load.
 */
const { test, expect } = require('@playwright/test');
const { readCtx, gotoPipelineWithMockedSessions } = require('./_helpers');

test.describe('Action module lazy-load @smoke', () => {
  test('close.js is not requested until a Close action is clicked', async ({ page }) => {
    const requested = [];
    await page.route('**/js/actions/**', (route) => {
      requested.push(route.request().url());
      route.continue();
    });

    await gotoPipelineWithMockedSessions(page);
    const closeModuleHits = requested.filter((u) => u.includes('/js/actions/close.js'));
    expect(closeModuleHits, 'close.js must not load on initial dashboard paint').toHaveLength(0);

    const closeBtn = page.locator('.kcard-va-btn[data-va-action="feature-close"]').first();
    const hasClose = await closeBtn.count();
    if (hasClose === 0) {
      test.skip(true, 'No feature-close button in fixture — seed a closable feature to run this assertion');
    }
    await closeBtn.click();
    await page.waitForResponse((res) => res.url().includes('/js/actions/close.js') && res.status() === 200, { timeout: 10000 });
    expect(requested.some((u) => u.includes('/js/actions/close.js'))).toBeTruthy();
  });
});
