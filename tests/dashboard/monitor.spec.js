// @ts-check
const { test, expect } = require('@playwright/test');

// Mock data used across tests
const mockFeatures = [
  { id: '1', name: 'feature-one', stage: 'in-progress', agents: [{ id: 'cc', status: 'implementing', updatedAt: new Date().toISOString() }], specPath: '/repo/docs/specs/features/03-in-progress/feature-01-feature-one.md' },
  { id: '2', name: 'feature-two', stage: 'in-progress', agents: [{ id: 'cc', status: 'waiting', updatedAt: new Date().toISOString(), slashCommand: '/afd 02' }] },
  { id: '3', name: 'feature-three', stage: 'in-evaluation', agents: [{ id: 'cc', status: 'submitted', updatedAt: new Date().toISOString() }, { id: 'cx', status: 'submitted', updatedAt: new Date().toISOString() }], evalStatus: 'evaluating' },
];

const mockStatus = {
  repos: [
    {
      path: '/repo',
      name: 'repo',
      displayPath: 'repo',
      features: mockFeatures,
      research: [],
      feedback: [],
      doneTotal: 0,
    }
  ],
  summary: { implementing: 1, waiting: 1, submitted: 2, error: 0 },
  generatedAt: new Date().toISOString(),
};

async function loadMonitor(page) {
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.route('**/api/status', route => route.fulfill({ json: mockStatus }));
  await page.goto('/');
  // Wait for Alpine to initialise and the first poll to complete
  await page.waitForSelector('.feature-card', { timeout: 10000 });
}

test.describe('Monitor view', () => {
  test('renders feature cards from mocked /api/status data', async ({ page }) => {
    await loadMonitor(page);
    const cards = page.locator('.feature-card');
    await expect(cards).toHaveCount(3);
  });

  test('shows feature ID and name on each card', async ({ page }) => {
    await loadMonitor(page);
    const card = page.locator('.feature-card:has-text("feature-one")').first();
    await expect(card).toContainText('#1');
    await expect(card).toContainText('feature-one');
  });

  test('shows agent status dots', async ({ page }) => {
    await loadMonitor(page);
    // Each feature card has at least one agent row with a dot
    const dots = page.locator('.feature-card .dot');
    const count = await dots.count();
    expect(count).toBeGreaterThan(0);
  });

  test('shows implementing agent status', async ({ page }) => {
    await loadMonitor(page);
    const rows = page.locator('.feature-card .row.implementing');
    await expect(rows.first()).toBeVisible();
  });

  test('shows waiting agent status', async ({ page }) => {
    await loadMonitor(page);
    const rows = page.locator('.feature-card .row.waiting');
    await expect(rows.first()).toBeVisible();
  });

  test('shows Copy cmd button for waiting agent with slash command', async ({ page }) => {
    await loadMonitor(page);
    // feature-two has a waiting agent with slashCommand
    const copyBtns = page.locator('.feature-card .row.waiting button:has-text("Copy cmd")');
    await expect(copyBtns.first()).toBeVisible();
  });

  test('shows evaluating badge on in-evaluation feature', async ({ page }) => {
    await loadMonitor(page);
    const evalBadge = page.locator('.feature-card .eval-badge');
    await expect(evalBadge.first()).toBeVisible();
  });

  test('filter pills show correct summary counts', async ({ page }) => {
    await loadMonitor(page);
    const implementing = page.locator('#monitor-summary button:has-text("implementing")');
    await expect(implementing).toContainText('1 implementing');
    const waiting = page.locator('#monitor-summary button:has-text("waiting")');
    await expect(waiting).toContainText('1 waiting');
  });

  test('clicking a filter pill shows only matching cards', async ({ page }) => {
    await loadMonitor(page);
    const waitingPill = page.locator('#monitor-summary .pill-filter.waiting');
    await waitingPill.click();
    // Only feature-two (waiting) should appear
    const cards = page.locator('.feature-card');
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText('feature-two');
  });

  test('monitor type toggle exists with All/Features/Research/Feedback buttons', async ({ page }) => {
    await loadMonitor(page);
    const toggleBtns = page.locator('.monitor-toolbar .toggle-btn');
    await expect(toggleBtns).toHaveCount(4);
    await expect(toggleBtns.nth(0)).toContainText('All');
    await expect(toggleBtns.nth(1)).toContainText('Features');
    await expect(toggleBtns.nth(2)).toContainText('Research');
    await expect(toggleBtns.nth(3)).toContainText('Feedback');
  });

  test('switching to Features-only hides research cards', async ({ page }) => {
    const statusWithResearch = {
      ...mockStatus,
      repos: [{
        ...mockStatus.repos[0],
        research: [
          { id: '1', name: 'research-one', stage: 'in-progress', agents: [{ id: 'cc', status: 'implementing', updatedAt: new Date().toISOString() }] }
        ]
      }]
    };
    await page.route('**/api/**', route => route.fulfill({ json: {} }));
    await page.route('**/api/status', route => route.fulfill({ json: statusWithResearch }));
    await page.goto('/');
    await page.waitForSelector('.feature-card', { timeout: 10000 });

    await page.locator('.monitor-toolbar .toggle-btn:has-text("Features")').click();
    // Research cards should not appear
    const researchCards = page.locator('.card.research');
    await expect(researchCards).toHaveCount(0);
  });
});
