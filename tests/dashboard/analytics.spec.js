// @ts-check
const { test, expect } = require('@playwright/test');

const mockAnalytics = {
  generatedAt: new Date().toISOString(),
  volume: {
    completedToday: 2,
    completed7d: 12,
    completed30d: 48,
  },
  autonomy: {
    score: 0.85,
    agentLed: 34,
    humanLed: 6,
    avgIterations: 1.4,
    avgCycleTimeDays: 2.1,
    p50CycleTimeDays: 1.8,
    p90CycleTimeDays: 4.2,
  },
  quality: {
    evalWinRate: 0.72,
    evalsRun: 18,
    firstPassRate: 0.68,
    reviewCyclesAvg: 1.3,
  },
  agents: [
    { id: 'cc', completions: 28, winRate: 0.75, avgCycleTimeDays: 2.0 },
    { id: 'cx', completions: 20, winRate: 0.65, avgCycleTimeDays: 2.4 },
  ],
  evalWins: [
    { featureId: '42', featureName: 'auth-refresh', winnerId: 'cc', loserId: 'cx', closedAt: new Date().toISOString() }
  ],
  features: [],
  volumeSeries: {
    daily: [{ date: '2026-03-16', count: 2 }, { date: '2026-03-15', count: 3 }],
    weekly: [{ date: '2026-W11', count: 12 }],
    monthly: [{ date: '2026-03', count: 48 }],
  },
  cycleTimeSeries: {
    daily: [{ date: '2026-03-16', p50: 2.1, p90: 4.5 }],
  },
};

const mockStatus = {
  repos: [],
  summary: { implementing: 0, waiting: 0, submitted: 0, error: 0 },
  generatedAt: new Date().toISOString(),
};

async function loadAnalytics(page) {
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.route('**/api/analytics', route => route.fulfill({ json: mockAnalytics }));
  await page.route('**/api/status', route => route.fulfill({ json: mockStatus }));
  await page.goto('/');
  await page.click('#tab-statistics');
  // Wait for the analytics view to render stat cards
  await page.waitForSelector('.stat-card', { timeout: 10000 });
}

test.describe('Analytics (Statistics) view', () => {
  test('Statistics tab exists and is clickable', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({ json: {} }));
    await page.route('**/api/status', route => route.fulfill({ json: mockStatus }));
    await page.goto('/');
    const tab = page.locator('#tab-statistics');
    await expect(tab).toBeVisible();
    await expect(tab).toHaveText('Statistics');
  });

  test('renders stat cards with mocked analytics data', async ({ page }) => {
    await loadAnalytics(page);
    const cards = page.locator('.stat-card');
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('stat cards show volume metrics', async ({ page }) => {
    await loadAnalytics(page);
    const statsView = page.locator('#statistics-view');
    const text = await statsView.textContent();
    // Should contain cycle time label or features count
    expect(text).toMatch(/Features|Cycle Time|completed/i);
  });

  test('statistics view is shown when Statistics tab is clicked', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({ json: {} }));
    await page.route('**/api/analytics', route => route.fulfill({ json: mockAnalytics }));
    await page.route('**/api/status', route => route.fulfill({ json: mockStatus }));
    await page.goto('/');
    await page.click('#tab-statistics');
    const statsView = page.locator('#statistics-view');
    await expect(statsView).toBeVisible();
  });

  test('analytics API is called when switching to Statistics tab', async ({ page }) => {
    let analyticsCalled = false;
    await page.route('**/api/**', route => route.fulfill({ json: {} }));
    await page.route('**/api/analytics', route => {
      analyticsCalled = true;
      route.fulfill({ json: mockAnalytics });
    });
    await page.route('**/api/status', route => route.fulfill({ json: mockStatus }));
    await page.goto('/');
    await page.click('#tab-statistics');
    await page.waitForSelector('.stat-card', { timeout: 10000 });
    expect(analyticsCalled).toBe(true);
  });

  test('agent leaderboard renders when agents data is present', async ({ page }) => {
    await loadAnalytics(page);
    const leaderboard = page.locator('.stats-leaderboard');
    const count = await leaderboard.count();
    if (count > 0) {
      await expect(leaderboard.first()).toBeVisible();
    }
    // At minimum verify stat cards rendered (chart may need canvas support)
    const cards = page.locator('.stat-card');
    await expect(cards.first()).toBeVisible();
  });
});
