// @ts-check
const { test, expect } = require('@playwright/test');

const mockFeatures = [
  { id: '1', name: 'feature-one', stage: 'inbox', agents: [], validActions: [{ type: 'transition', action: 'feature-prioritise', to: 'backlog', label: 'Prioritise' }] },
  { id: '2', name: 'feature-two', stage: 'backlog', agents: [], validActions: [] },
  {
    id: '3',
    name: 'feature-three',
    stage: 'in-progress',
    agents: [{
      id: 'cc',
      status: 'submitted',
      updatedAt: new Date().toISOString(),
      worktreePath: '/repo-worktrees/feature-3-cc-feature-three',
      devServerEligible: true,
      devServerPokeEligible: true,
      devServerUrl: null
    }],
    validActions: []
  },
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
      mainDevServerEligible: true,
      mainDevServerRunning: false,
      mainDevServerUrl: null
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

  test('in-progress column shows agent name', async ({ page }) => {
    await loadPipeline(page);
    const inProgressCol = page.locator('.kanban-col[data-stage="in-progress"]').first();
    await expect(inProgressCol).toBeVisible();
    const agentName = inProgressCol.locator('.kcard-agent-name');
    await expect(agentName.first()).toBeVisible();
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

  test('Inbox column shows + New Feature button in Features mode', async ({ page }) => {
    await loadPipeline(page);
    const createBtn = page.locator('.kanban-col[data-stage="inbox"] .col-new-feature-btn').first();
    await expect(createBtn).toContainText('+ New Feature');
    await expect(createBtn).toBeVisible();
  });

  test('New Feature modal opens with name and description fields', async ({ page }) => {
    await loadPipeline(page);
    await page.locator('.kanban-col[data-stage="inbox"] .col-new-feature-btn').first().click();
    await expect(page.locator('#create-modal')).toBeVisible();
    await expect(page.locator('#create-modal-name')).toBeVisible();
    await expect(page.locator('#create-modal-description')).toBeVisible();
  });

  test('New Feature modal validates required name', async ({ page }) => {
    await loadPipeline(page);
    await page.locator('.kanban-col[data-stage="inbox"] .col-new-feature-btn').first().click();
    await page.locator('#create-modal-submit').click();
    await expect(page.locator('#create-modal-error')).toContainText('Feature name is required.');
  });

  test('creating a feature posts feature-create and seeds ask session with description', async ({ page }) => {
    let actionPayload = null;
    let askPayload = null;
    const featureName = 'new feature from dashboard';
    const featureSlug = 'new-feature-from-dashboard';
    let currentStatus = mockStatus;

    await page.route('**/api/**', route => route.fulfill({ json: {} }));
    await page.route('**/api/status', route => route.fulfill({ json: currentStatus }));
    await page.route('**/api/refresh', route => route.fulfill({ json: currentStatus }));
    await page.route('**/api/action', async route => {
      actionPayload = await route.request().postDataJSON();
      currentStatus = {
        ...mockStatus,
        repos: [{
          ...mockStatus.repos[0],
          features: [{ id: null, name: featureSlug, stage: 'inbox', agents: [], validActions: [] }, ...mockStatus.repos[0].features]
        }],
        generatedAt: new Date().toISOString(),
      };
      route.fulfill({ status: 200, json: { ok: true, command: 'aigon feature-create', exitCode: 0 } });
    });
    await page.route('**/api/session/ask', async route => {
      askPayload = await route.request().postDataJSON();
      route.fulfill({ status: 200, json: { ok: true, sessionName: 'ask-repo-cc' } });
    });

    await page.goto('/');
    await page.click('#tab-pipeline');
    await page.waitForSelector('.kanban', { timeout: 10000 });
    await page.locator('.kanban-col[data-stage="inbox"] .col-new-feature-btn').first().click();
    await page.fill('#create-modal-name', featureName);
    await page.fill('#create-modal-description', 'Add creation flow without leaving pipeline.');
    await page.locator('#create-modal-submit').click();

    await expect.poll(() => actionPayload).not.toBeNull();
    expect(actionPayload.action).toBe('feature-create');
    expect(actionPayload.args).toEqual([featureName]);
    expect(typeof actionPayload.repoPath).toBe('string');
    expect(actionPayload.repoPath.length).toBeGreaterThan(0);

    await expect.poll(() => askPayload).not.toBeNull();
    expect(askPayload.repoPath).toBe(actionPayload.repoPath);
    expect(askPayload.message).toContain(`docs/specs/features/01-inbox/feature-${featureSlug}.md`);
    expect(askPayload.message).toContain('Add creation flow without leaving pipeline.');

    await expect(page.locator('#create-modal')).not.toBeVisible();
    await expect(page.locator('.kanban-col[data-stage="inbox"]')).toContainText('new feature from dashboard');
  });

  test('feature-create error remains in modal and shows API error message', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({ json: {} }));
    await page.route('**/api/status', route => route.fulfill({ json: mockStatus }));
    await page.route('**/api/action', route => route.fulfill({
      status: 422,
      json: { error: 'Feature already exists', details: { stderr: 'Feature already exists in inbox' } }
    }));

    await page.goto('/');
    await page.click('#tab-pipeline');
    await page.waitForSelector('.kanban', { timeout: 10000 });
    await page.locator('.kanban-col[data-stage="inbox"] .col-new-feature-btn').first().click();
    await page.fill('#create-modal-name', 'feature one');
    await page.locator('#create-modal-submit').click();

    await expect(page.locator('#create-modal')).toBeVisible();
    await expect(page.locator('#create-modal-error')).toContainText('Feature already exists');
  });

  test('repo header dev-server globe starts main dev server via API', async ({ page }) => {
    let startCalled = false;
    const statusData = {
      ...mockStatus,
      generatedAt: new Date().toISOString(),
    };

    await page.addInitScript(() => {
      window.__lastOpened = null;
      window.open = function(url) {
        window.__lastOpened = url;
        return null;
      };
    });

    await page.route('**/api/**', route => route.fulfill({ json: {} }));
    await page.route('**/api/status', route => route.fulfill({ json: statusData }));
    await page.route('**/api/refresh', route => route.fulfill({ json: statusData }));
    await page.route('**/api/repos/**/dev-server/start', route => {
      startCalled = true;
      route.fulfill({ status: 200, json: { ok: true, url: 'http://repo.localhost', message: 'Started main dev server at http://repo.localhost' } });
    });

    await page.goto('/');
    await page.click('#tab-pipeline');
    await page.waitForSelector('.kanban', { timeout: 10000 });
    await page.locator('.sidebar-item').nth(1).click();
    const globeBtn = page.locator('#repo-header .repo-dev-link-idle').first();
    await expect(globeBtn).toBeVisible();
    await globeBtn.click();

    await expect.poll(() => startCalled).toBe(true);
  });

  test('start preview button pokes worktree dev server via API', async ({ page }) => {
    let pokePath = null;
    const statusData = {
      ...mockStatus,
      generatedAt: new Date().toISOString(),
    };

    await page.route('**/api/**', route => route.fulfill({ json: {} }));
    await page.route('**/api/status', route => route.fulfill({ json: statusData }));
    await page.route('**/api/refresh', route => route.fulfill({ json: statusData }));
    await page.route('**/api/repos/%2Frepo/features/3/agents/cc/dev-server/poke', route => {
      pokePath = route.request().url();
      route.fulfill({ status: 200, json: { ok: true, mode: 'send-keys', message: 'Sent dev-server start' } });
    });

    await page.goto('/');
    await page.click('#tab-pipeline');
    await page.waitForSelector('.kanban', { timeout: 10000 });

    const pokeBtn = page.locator('.kcard-dev-poke-btn:has-text("Start preview")').first();
    await expect(pokeBtn).toBeVisible();
    await pokeBtn.click();

    await expect.poll(() => pokePath).toContain('/api/repos/%2Frepo/features/3/agents/cc/dev-server/poke');
  });
});
