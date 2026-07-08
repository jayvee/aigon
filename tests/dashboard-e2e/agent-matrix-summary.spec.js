// @ts-check
'use strict';

/**
 * F619: model summary headlines surface in Settings → Agent Matrix.
 * REGRESSION: /api/agent-matrix summary.headline must render under model labels.
 */

const { test, expect } = require('@playwright/test');
const { gotoPipelineWithMockedSessions } = require('./_helpers');

test.describe('Agent matrix model summaries @smoke', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => {
      if (msg.type() === 'error' && !msg.text().includes('favicon')) {
        throw new Error(`console error: ${msg.text()}`);
      }
    });
    await gotoPipelineWithMockedSessions(page);
  });

  test('Settings Agent Matrix shows cc Sonnet summary headline @smoke', async ({ page }) => {
    await page.click('#tab-settings');
    await expect(page.locator('#settings-view')).toBeVisible({ timeout: 8000 });
    await page.click('button.settings-nav-btn:has-text("Agent Matrix")');
    const headline = page.locator('.matrix-model-summary', {
      hasText: 'Best all-round choice for implementation and code review',
    });
    await expect(headline.first()).toBeVisible({ timeout: 10000 });
  });
});
