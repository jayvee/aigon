// @ts-check
const { test, expect } = require('@playwright/test');

const mockFeatures = [
  { id: '1', name: 'feature-one', stage: 'inbox', agents: [], validActions: [{ type: 'transition', action: 'feature-prioritise', to: 'backlog', label: 'Prioritise' }] },
  { id: '2', name: 'feature-two', stage: 'backlog', agents: [], validActions: [] },
  { id: '3', name: 'feature-three', stage: 'in-progress', agents: [{ id: 'cc', status: 'implementing', updatedAt: new Date().toISOString() }], validActions: [] },
  { id: '4', name: 'feature-four', stage: 'in-evaluation', agents: [], validActions: [] },
  { id: '5', name: 'feature-five', stage: 'done', agents: [], validActions: [] },
  { id: '6', name: 'feature-six', stage: 'done', agents: [], validActions: [] },
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
      doneTotal: 2,
    }
  ],
  summary: { implementing: 1, waiting: 0, submitted: 0, error: 0 },
  generatedAt: new Date().toISOString(),
};

async function loadPipeline(page) {
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.route('**/api/status', route => route.fulfill({ json: mockStatus }));
  await page.goto('/');
  await page.click('#tab-pipeline');
  await page.waitForSelector('.kanban', { timeout: 10000 });
}

test.describe('Pipeline view', () => {
  test('renders kanban board with 5 stage columns', async ({ page }) => {
    await loadPipeline(page);
    const cols = page.locator('.kanban-col');
    await expect(cols).toHaveCount(5);
  });

  test('renders all stage column headers', async ({ page }) => {
    await loadPipeline(page);
    const stages = ['inbox', 'backlog', 'in-progress', 'in-evaluation', 'done'];
    for (const stage of stages) {
      const col = page.locator(`.kanban-col[data-stage="${stage}"]`).first();
      await expect(col).toBeVisible();
    }
  });

  test('inbox column shows feature card', async ({ page }) => {
    await loadPipeline(page);
    const inboxCol = page.locator('.kanban-col[data-stage="inbox"]').first();
    // Kanban renders feature names with hyphens replaced by spaces
    await expect(inboxCol).toContainText('feature one');
  });

  test('in-progress column shows agent badge', async ({ page }) => {
    await loadPipeline(page);
    const inProgressCol = page.locator('.kanban-col[data-stage="in-progress"]').first();
    await expect(inProgressCol).toBeVisible();
    const badge = inProgressCol.locator('.agent-badge');
    await expect(badge.first()).toBeVisible();
  });

  test('column counts show correct numbers', async ({ page }) => {
    await loadPipeline(page);
    const inboxCount = page.locator('.kanban-col[data-stage="inbox"] .col-count').first();
    await expect(inboxCount).toContainText('1');
    const backlogCount = page.locator('.kanban-col[data-stage="backlog"] .col-count').first();
    await expect(backlogCount).toContainText('1');
  });

  test('pipeline type toggle has Features/Research/Feedback buttons', async ({ page }) => {
    await loadPipeline(page);
    const toggleBtns = page.locator('#pipeline-view .toggle-btn');
    await expect(toggleBtns).toHaveCount(3);
    await expect(toggleBtns.nth(0)).toContainText('Features');
    await expect(toggleBtns.nth(1)).toContainText('Research');
    await expect(toggleBtns.nth(2)).toContainText('Feedback');
    // Features is active by default
    await expect(toggleBtns.nth(0)).toHaveClass(/active/);
  });

  test('switching to Research shows research-specific stages', async ({ page }) => {
    const statusWithResearch = {
      ...mockStatus,
      repos: [{
        ...mockStatus.repos[0],
        research: [{ id: '1', name: 'research-one', stage: 'in-progress', agents: [] }]
      }]
    };
    await page.route('**/api/**', route => route.fulfill({ json: {} }));
    await page.route('**/api/status', route => route.fulfill({ json: statusWithResearch }));
    await page.goto('/');
    await page.click('#tab-pipeline');
    await page.waitForSelector('.kanban', { timeout: 10000 });

    await page.locator('#pipeline-view .toggle-btn:has-text("Research")').click();
    // Research pipeline has a 'paused' stage instead of 'in-evaluation'
    const pausedCol = page.locator('.kanban-col[data-stage="paused"]').first();
    await expect(pausedCol).toBeVisible();
    const evalCol = page.locator('.kanban-col[data-stage="in-evaluation"]');
    await expect(evalCol).toHaveCount(0);
  });

  test('switching to Feedback shows feedback-specific stages', async ({ page }) => {
    await loadPipeline(page);
    await page.locator('#pipeline-view .toggle-btn:has-text("Feedback")').click();
    const triagedCol = page.locator('.kanban-col[data-stage="triaged"]').first();
    await expect(triagedCol).toBeVisible();
    const actionableCol = page.locator('.kanban-col[data-stage="actionable"]').first();
    await expect(actionableCol).toBeVisible();
  });

  test('Create button is visible in pipeline toolbar', async ({ page }) => {
    await loadPipeline(page);
    const createBtn = page.locator('#pipeline-view button:has-text("+ Create")');
    await expect(createBtn).toBeVisible();
  });
});
