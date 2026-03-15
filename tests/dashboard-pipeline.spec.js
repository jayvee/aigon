// @ts-check
const { test, expect } = require('@playwright/test');

const DASHBOARD_URL = 'http://127.0.0.1:4321';

test.describe('Dashboard Pipeline View', () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage to start fresh
    await page.goto(DASHBOARD_URL);
    await page.evaluate(() => localStorage.clear());
    await page.goto(DASHBOARD_URL);
  });

  test('API returns features in all stages', async ({ request }) => {
    const resp = await request.get(`${DASHBOARD_URL}/api/status`);
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(data.repos.length).toBeGreaterThan(0);

    // At least one repo should have inbox features
    const stagesFound = new Set();
    data.repos.forEach(r => {
      (r.features || []).forEach(f => stagesFound.add(f.stage));
    });
    expect(stagesFound.has('inbox')).toBeTruthy();
    expect(stagesFound.has('done')).toBeTruthy();
  });

  test('Pipeline view renders all stage columns', async ({ page }) => {
    // Switch to Pipeline view
    await page.click('#tab-pipeline');
    await page.waitForSelector('.kanban');

    const stages = ['inbox', 'backlog', 'in-progress', 'in-evaluation', 'done'];
    for (const stage of stages) {
      const col = page.locator(`.kanban-col[data-stage="${stage}"]`).first();
      await expect(col).toBeVisible();
    }
  });

  test('Pipeline Inbox column has items for repos with inbox features', async ({ page, request }) => {
    // Get expected counts from API
    const resp = await request.get(`${DASHBOARD_URL}/api/status`);
    const data = await resp.json();

    // Find repos with inbox features
    const reposWithInbox = data.repos.filter(r =>
      (r.features || []).some(f => f.stage === 'inbox')
    );
    expect(reposWithInbox.length).toBeGreaterThan(0);

    // Switch to Pipeline view
    await page.click('#tab-pipeline');
    await page.waitForSelector('.kanban');

    // Check that Inbox columns show non-zero counts
    const inboxCounts = await page.locator('.kanban-col[data-stage="inbox"] .col-count').allTextContents();
    const totalInbox = inboxCounts.reduce((sum, c) => sum + parseInt(c, 10), 0);
    expect(totalInbox).toBeGreaterThan(0);
  });

  test('Pipeline Done column has items for repos with done features', async ({ page, request }) => {
    const resp = await request.get(`${DASHBOARD_URL}/api/status`);
    const data = await resp.json();

    const reposWithDone = data.repos.filter(r =>
      (r.features || []).some(f => f.stage === 'done')
    );
    expect(reposWithDone.length).toBeGreaterThan(0);

    await page.click('#tab-pipeline');
    await page.waitForSelector('.kanban');

    const doneCounts = await page.locator('.kanban-col[data-stage="done"] .col-count').allTextContents();
    const totalDone = doneCounts.reduce((sum, c) => sum + parseInt(c, 10), 0);
    expect(totalDone).toBeGreaterThan(0);
  });

  test('Done column caps at 6 items with "more" button', async ({ page, request }) => {
    const resp = await request.get(`${DASHBOARD_URL}/api/status`);
    const data = await resp.json();

    // Find a repo with >6 done features
    const repoWith7PlusDone = data.repos.find(r =>
      (r.features || []).filter(f => f.stage === 'done').length > 6
    );

    if (!repoWith7PlusDone) {
      test.skip();
      return;
    }

    await page.click('#tab-pipeline');
    await page.waitForSelector('.kanban');

    // The done column for that repo should show a "more" button
    const moreBtns = page.locator('.kanban-col[data-stage="done"] button:has-text("more")');
    await expect(moreBtns.first()).toBeVisible();
  });

  test('Sidebar renders with repo entries', async ({ page }) => {
    // Switch to Pipeline view to see sidebar
    await page.click('#tab-pipeline');
    await page.waitForSelector('.repo-sidebar');

    const sidebarItems = page.locator('.sidebar-item');
    // Should have "All" + at least one repo
    expect(await sidebarItems.count()).toBeGreaterThanOrEqual(2);

    // First item should be "All Repos"
    await expect(sidebarItems.first()).toContainText('All');
  });

  test('Clicking a repo in sidebar shows only that repo', async ({ page, request }) => {
    const resp = await request.get(`${DASHBOARD_URL}/api/status`);
    const data = await resp.json();
    const firstRepo = data.repos[0];

    await page.click('#tab-pipeline');
    await page.waitForSelector('.repo-sidebar');

    // Click the first repo (skip "All" which is index 0)
    const repoItem = page.locator('.sidebar-item').nth(1);
    await repoItem.click();

    // Repo header bar should appear
    await expect(page.locator('.repo-header-bar')).toBeVisible();

    // Only one kanban board should be visible (single repo)
    const kanbanBoards = page.locator('.kanban');
    expect(await kanbanBoards.count()).toBe(1);
  });

  test('Sidebar persists selection in localStorage', async ({ page }) => {
    await page.click('#tab-pipeline');
    await page.waitForSelector('.repo-sidebar');

    // Click a repo
    const repoItem = page.locator('.sidebar-item').nth(1);
    await repoItem.click();

    // Check localStorage
    const savedRepo = await page.evaluate(() => localStorage.getItem('aigon.dashboard.selectedRepo'));
    expect(savedRepo).toBeTruthy();
    expect(savedRepo).not.toBe('all');

    // Reload and verify persistence
    await page.reload();
    await page.click('#tab-pipeline');
    await page.waitForSelector('.repo-sidebar');

    // The same repo should still be selected
    const activeItem = page.locator('.sidebar-item.active');
    await expect(activeItem).toHaveCount(1);
  });

  test('Settings view renders with repo list', async ({ page }) => {
    await page.click('#tab-settings');
    await page.waitForSelector('.settings-area');

    // Should have repo list items
    const repoRows = page.locator('.repo-list-item');
    expect(await repoRows.count()).toBeGreaterThan(0);
  });

  test('Keyboard navigation in sidebar', async ({ page }) => {
    await page.click('#tab-pipeline');
    await page.waitForSelector('.repo-sidebar');

    // Focus the "All Repos" button (first sidebar item, has tabindex=0)
    await page.locator('.sidebar-item').first().focus();

    // Press ArrowDown to move to first repo item
    await page.keyboard.press('ArrowDown');

    // Press Enter to select that repo
    await page.keyboard.press('Enter');

    // Should show repo header (the element exists but becomes visible)
    const header = page.locator('#repo-header');
    await expect(header).toBeVisible();
  });

  test('Pipeline type toggle renders with three options', async ({ page }) => {
    await page.click('#tab-pipeline');
    await page.waitForSelector('.pipeline-type-toggle');

    const buttons = page.locator('.toggle-btn');
    await expect(buttons).toHaveCount(3);
    await expect(buttons.nth(0)).toContainText('Features');
    await expect(buttons.nth(1)).toContainText('Research');
    await expect(buttons.nth(2)).toContainText('Feedback');

    // Features should be active by default
    await expect(buttons.nth(0)).toHaveClass(/active/);
  });

  test('Switching to Research view shows research stages', async ({ page }) => {
    await page.click('#tab-pipeline');
    await page.waitForSelector('.pipeline-type-toggle');

    // Click Research
    await page.locator('.toggle-btn:has-text("Research")').click();
    await page.waitForSelector('.kanban');

    // Research has different stages — check for "Paused" column instead of "Evaluation"
    const pausedCol = page.locator('.kanban-col[data-stage="paused"]').first();
    await expect(pausedCol).toBeVisible();

    // Should NOT have "in-evaluation" column
    const evalCol = page.locator('.kanban-col[data-stage="in-evaluation"]');
    await expect(evalCol).toHaveCount(0);
  });

  test('Switching to Feedback view shows feedback stages', async ({ page }) => {
    await page.click('#tab-pipeline');
    await page.waitForSelector('.pipeline-type-toggle');

    await page.locator('.toggle-btn:has-text("Feedback")').click();
    await page.waitForSelector('.kanban');

    // Feedback has "triaged" and "actionable" columns
    const triagedCol = page.locator('.kanban-col[data-stage="triaged"]').first();
    await expect(triagedCol).toBeVisible();

    const actionableCol = page.locator('.kanban-col[data-stage="actionable"]').first();
    await expect(actionableCol).toBeVisible();
  });

  test('API returns research and feedback data', async ({ request }) => {
    const resp = await request.get(`${DASHBOARD_URL}/api/status`);
    const data = await resp.json();

    // At least one repo should have research items
    const hasResearch = data.repos.some(r => (r.research || []).length > 0);
    expect(hasResearch).toBeTruthy();

    // doneTotal fields should exist
    const hasResearchDoneTotal = data.repos.some(r => r.researchDoneTotal > 0);
    expect(hasResearchDoneTotal).toBeTruthy();
  });
});
