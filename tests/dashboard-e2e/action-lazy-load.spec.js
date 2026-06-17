// @ts-check
'use strict';
/**
 * E2E: lazy-load action modules — start.js fetched only after Start click.
 * REGRESSION: F519 dynamic import() must not prefetch modal modules on page load.
 */
const { test, expect } = require('@playwright/test');
const { gotoPipelineWithMockedSessions } = require('./_helpers');

test.describe('Action module lazy-load @smoke', () => {
  test('start.js is not requested until a Start action is clicked', async ({ page }) => {
    const requested = [];
    await page.route('**/js/actions/**', (route) => {
      requested.push(route.request().url());
      route.continue();
    });

    await gotoPipelineWithMockedSessions(page);
    const startModuleHits = requested.filter((u) => u.includes('/js/actions/start.js'));
    expect(startModuleHits, 'start.js must not load on initial dashboard paint').toHaveLength(0);

    const startBtn = page.locator('.kcard-va-btn[data-va-action="feature-start"]').first();
    await expect(startBtn, 'fixture should include a startable backlog feature').toBeVisible();
    await startBtn.click();
    await page.waitForResponse((res) => res.url().includes('/js/actions/start.js') && res.status() === 200, { timeout: 10000 });
    expect(requested.some((u) => u.includes('/js/actions/start.js'))).toBeTruthy();
  });

  test('autonomous action module opens the Start Autonomously modal', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message || String(err)));

    await gotoPipelineWithMockedSessions(page);

    await page.evaluate(() => {
      const btn = document.querySelector('[data-va-action="feature-autonomous-start"]');
      if (!btn) throw new Error('fixture missing feature-autonomous-start action');
      btn.click();
    });

    await expect(page.locator('#autonomous-modal')).toBeVisible();
    await expect(page.getByText('Action failed to load. Try refreshing the page.')).toHaveCount(0);
    expect(consoleErrors.join('\n')).not.toContain('AUTONOMOUS_AGENT_IDS');
  });
});
