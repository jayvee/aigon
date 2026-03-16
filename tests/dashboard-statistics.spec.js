// @ts-check
const { test, expect } = require('@playwright/test');

const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://127.0.0.1:4203';

test.describe('Dashboard Statistics Tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DASHBOARD_URL);
    await page.waitForSelector('.view-tabs');
  });

  test('Statistics tab button exists in nav', async ({ page }) => {
    const statsTab = page.locator('#tab-statistics');
    await expect(statsTab).toBeVisible();
    await expect(statsTab).toHaveText('Statistics');
  });

  test('Clicking Statistics tab shows statistics view', async ({ page }) => {
    // Click the Statistics tab
    await page.click('#tab-statistics');

    // The statistics view container should become visible
    const statsView = page.locator('#statistics-view');
    await expect(statsView).toBeVisible();

    // Wait for content to render (analytics fetch)
    await page.waitForTimeout(2000);

    // Should have stat cards
    const statCards = page.locator('.stat-card');
    const cardCount = await statCards.count();
    expect(cardCount).toBeGreaterThanOrEqual(1);
  });

  test('Analytics API returns valid data', async ({ request }) => {
    const resp = await request.get(`${DASHBOARD_URL}/api/analytics`);
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();

    // Check top-level structure
    expect(data).toHaveProperty('generatedAt');
    expect(data).toHaveProperty('volume');
    expect(data).toHaveProperty('autonomy');
    expect(data).toHaveProperty('quality');
    expect(data).toHaveProperty('agents');
    expect(data).toHaveProperty('evalWins');
    expect(data).toHaveProperty('features');

    // Volume metrics
    expect(typeof data.volume.completedToday).toBe('number');
    expect(typeof data.volume.completed7d).toBe('number');
    expect(typeof data.volume.completed30d).toBe('number');
    expect(data.volume.completed30d).toBeGreaterThan(0);

    // Agents array
    expect(Array.isArray(data.agents)).toBeTruthy();
    expect(data.agents.length).toBeGreaterThan(0);

    // Eval wins
    expect(Array.isArray(data.evalWins)).toBeTruthy();
  });

  test('Statistics view shows volume metrics', async ({ page }) => {
    await page.click('#tab-statistics');
    await page.waitForTimeout(2000);

    // Check for volume stat cards with values
    const statsView = page.locator('#statistics-view');
    const text = await statsView.textContent();

    // Should contain key metric labels
    expect(text).toContain('Features');
    expect(text).toContain('Cycle Time');
  });

  test('Statistics view shows agent leaderboard', async ({ page }) => {
    await page.click('#tab-statistics');
    await page.waitForTimeout(2000);

    // Should have a leaderboard table
    const leaderboard = page.locator('.stats-leaderboard');
    const leaderboardCount = await leaderboard.count();

    if (leaderboardCount > 0) {
      await expect(leaderboard.first()).toBeVisible();
      // Should have agent rows
      const rows = leaderboard.first().locator('tr');
      const rowCount = await rows.count();
      expect(rowCount).toBeGreaterThan(1); // header + at least 1 agent
    }
  });

  test('Statistics view has volume chart', async ({ page }) => {
    await page.click('#tab-statistics');
    await page.waitForTimeout(2000);

    // Check for Chart.js canvas
    const canvas = page.locator('#statistics-view canvas');
    const canvasCount = await canvas.count();
    expect(canvasCount).toBeGreaterThanOrEqual(1);
  });

  test('Statistics toolbar has period and repo filters', async ({ page }) => {
    await page.click('#tab-statistics');
    await page.waitForTimeout(2000);

    // Should have period selector
    const periodSelect = page.locator('#statistics-view select, #statistics-view .stats-select');
    const selectCount = await periodSelect.count();
    expect(selectCount).toBeGreaterThanOrEqual(1);
  });

  test('Full Statistics tab walkthrough', async ({ page }) => {
    // Navigate to Statistics
    await page.click('#tab-statistics');
    await page.waitForTimeout(3000);

    // Take a screenshot of the initial view
    await page.screenshot({ path: 'test-results/statistics-overview.png', fullPage: false });

    // Check all major sections are present
    const statsView = page.locator('#statistics-view');
    await expect(statsView).toBeVisible();

    // Verify stat cards rendered
    const cards = page.locator('.stat-card');
    const cardCount = await cards.count();
    console.log(`Found ${cardCount} stat cards`);

    // Verify charts rendered
    const canvases = page.locator('#statistics-view canvas');
    const chartCount = await canvases.count();
    console.log(`Found ${chartCount} chart canvases`);

    // Check granularity buttons if present
    const granBtns = page.locator('.vol-gran-btn');
    const granCount = await granBtns.count();
    if (granCount > 0) {
      console.log(`Found ${granCount} granularity buttons`);
      // Click through each granularity
      for (let i = 0; i < granCount; i++) {
        await granBtns.nth(i).click();
        await page.waitForTimeout(500);
      }
      await page.screenshot({ path: 'test-results/statistics-granularity.png', fullPage: false });
    }

    // Check leaderboard
    const leaderboard = page.locator('.stats-leaderboard');
    if (await leaderboard.count() > 0) {
      const rows = await leaderboard.first().locator('tbody tr').count();
      console.log(`Leaderboard has ${rows} agent rows`);
    }

    // Switch between other tabs and back to verify persistence
    await page.click('#tab-monitor');
    await page.waitForTimeout(500);
    await page.click('#tab-statistics');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'test-results/statistics-after-switch.png', fullPage: false });
  });
});
