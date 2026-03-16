// @ts-check
const { test, expect } = require('@playwright/test');

const mockFeatureWithAction = {
  id: '1',
  name: 'feature-one',
  stage: 'in-progress',
  agents: [{ id: 'cc', status: 'waiting', updatedAt: new Date().toISOString(), slashCommand: '/afd 01' }],
  nextActions: [{ command: 'aigon feature-do 01', label: 'Run', reason: 'feature is in progress', mode: 'fire-and-forget' }],
  specPath: '/repo/docs/specs/features/03-in-progress/feature-01-feature-one.md',
};

const mockFeatureKanban = {
  id: '2',
  name: 'feature-two',
  stage: 'inbox',
  agents: [],
  validActions: [
    { type: 'action', action: 'feature-prioritise', label: 'Prioritise', priority: 'high' }
  ],
};

const mockStatus = {
  repos: [{
    path: '/repo',
    name: 'repo',
    displayPath: 'repo',
    features: [mockFeatureWithAction, mockFeatureKanban],
    research: [],
    feedback: [],
    doneTotal: 0,
  }],
  summary: { implementing: 0, waiting: 1, submitted: 0, error: 0 },
  generatedAt: new Date().toISOString(),
};

const mockRefresh = {
  ...mockStatus,
  generatedAt: new Date().toISOString(),
};

test.describe('Action buttons', () => {
  test('clicking Run Next primary button POSTs to /api/session/run with correct payload', async ({ page }) => {
    let sessionRunPayload = null;
    await page.route('**/api/**', route => route.fulfill({ json: {} }));
    await page.route('**/api/refresh', route => route.fulfill({ json: mockRefresh }));
    await page.route('**/api/session/run', async route => {
      sessionRunPayload = await route.request().postDataJSON();
      route.fulfill({ json: { exitCode: 0 } });
    });
    await page.route('**/api/status', route => route.fulfill({ json: mockStatus }));

    await page.goto('/');
    await page.waitForSelector('.feature-card', { timeout: 10000 });

    const runBtn = page.locator('.run-next-primary').first();
    await expect(runBtn).toBeVisible();
    await runBtn.click();

    await page.waitForTimeout(500);
    expect(sessionRunPayload).not.toBeNull();
    expect(sessionRunPayload.command).toBe('aigon feature-do 01');
  });

  test('clicking action button in pipeline view POSTs to /api/action with correct payload', async ({ page }) => {
    let actionPayload = null;
    await page.route('**/api/**', route => route.fulfill({ json: {} }));
    await page.route('**/api/refresh', route => route.fulfill({ json: mockRefresh }));
    await page.route('**/api/action', async route => {
      actionPayload = await route.request().postDataJSON();
      route.fulfill({ json: { command: 'feature-prioritise' } });
    });
    await page.route('**/api/status', route => route.fulfill({ json: mockStatus }));

    await page.goto('/');
    await page.click('#tab-pipeline');
    await page.waitForSelector('.kanban', { timeout: 10000 });
    await page.waitForSelector('.kcard-va-btn', { timeout: 5000 });

    const prioritiseBtn = page.locator('.kcard-va-btn').first();
    await expect(prioritiseBtn).toBeVisible();
    await prioritiseBtn.click();

    await page.waitForTimeout(500);
    expect(actionPayload).not.toBeNull();
    expect(actionPayload.action).toBeTruthy();
  });

  test('Copy cmd button copies slash command to clipboard', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({ json: {} }));
    await page.route('**/api/status', route => route.fulfill({ json: mockStatus }));

    // Grant clipboard permissions
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    await page.goto('/');
    await page.waitForSelector('.feature-card', { timeout: 10000 });

    const copyBtn = page.locator('.row.waiting button:has-text("Copy cmd")').first();
    await expect(copyBtn).toBeVisible();
    await copyBtn.click();

    // Should show a toast confirmation
    const toast = page.locator('.toast');
    await expect(toast.first()).toBeVisible({ timeout: 3000 });
    await expect(toast.first()).toContainText('Copied');
  });

  test('clicking feature card opens spec drawer when specPath is set', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({ json: {} }));
    await page.route('**/api/status', route => route.fulfill({ json: mockStatus }));

    await page.goto('/');
    await page.waitForSelector('.feature-card', { timeout: 10000 });

    const firstCard = page.locator('.feature-card').first();
    await firstCard.click();

    // Spec drawer should open
    const drawer = page.locator('#spec-drawer');
    await expect(drawer).toHaveClass(/open/, { timeout: 3000 });
  });
});
