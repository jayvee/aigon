const { chromium } = require('playwright');

const now = new Date().toISOString();

function agent(id, status, live = true) {
  return {
    id,
    status,
    tmuxRunning: live,
    tmuxSession: live ? `mock-${id}-${status}` : null,
    runtimeAgentId: id,
    model: id === 'cc' ? 'opus-4.1' : 'gpt-5.3-codex',
    effort: 'high',
    validActions: [],
  };
}

function feature(id, name, overrides = {}) {
  return {
    id,
    name,
    stage: 'in-progress',
    lifecycle: 'in-progress',
    createdAt: now,
    updatedAt: now,
    specPath: `/tmp/mock/docs/specs/features/03-in-progress/feature-${id}-${name}.md`,
    agents: [],
    validActions: [],
    reviewSessionSummary: [],
    specReviewSessions: [],
    specRevisionSessions: [],
    specCheckSessions: [],
    nudges: [],
    stateRenderMeta: { badge: null, cls: '', label: '' },
    detailFingerprint: `${id}-${name}`,
    ...overrides,
  };
}

const commonActions = [
  { action: 'feature-pause', label: 'Pause', priority: 'normal', category: 'lifecycle' },
  { action: 'feature-reset', label: 'Reset', priority: 'normal', category: 'lifecycle' },
];

const features = [
  feature('701', 'autonomous-dashboard-density-redesign', {
    set: 'dashboard-clarity',
    cardHeadline: { tone: 'running', glyph: '▶', verb: 'Implementing', owner: 'cx', age: 1840, detail: 'Building the adaptive in-progress workspace' },
    agents: [agent('cx', 'implementing')],
    validActions: commonActions,
    autonomousController: { status: 'running', running: true, reasonLabel: 'Implementing', sessionRunning: true, workflowState: 'implementing', updatedAt: now },
    autonomousSession: { sessionName: 'mock-f701-auto', running: true, sessionRunning: true, status: 'running' },
    autonomousPlan: {
      mode: 'solo_worktree',
      stages: [
        { key: 'implement', type: 'implement', label: 'Implement', status: 'running', agents: [{ id: 'cx' }] },
        { key: 'review', type: 'review', label: 'Review', status: 'waiting', agents: [{ id: 'cc' }] },
        { key: 'revision', type: 'revision', label: 'Revision', status: 'waiting', agents: [{ id: 'cx' }] },
        { key: 'close', type: 'close', label: 'Close', status: 'waiting', agents: [] },
      ],
    },
  }),
  feature('702', 'fleet-card-state-reconciliation', {
    set: 'dashboard-clarity',
    cardHeadline: { tone: 'attention', glyph: '◆', verb: 'Needs your decision', owner: null, age: 420, detail: 'Choose a fleet implementation to continue' },
    agents: [agent('cc', 'submitted', false), agent('gg', 'submitted', false), agent('cx', 'submitted', false)],
    validActions: [
      { action: 'select-winner', label: 'Pick winner', priority: 'high', category: 'lifecycle' },
      ...commonActions,
    ],
    evalStatus: 'pick winner',
    winnerAgent: 'cx',
    evalPath: '/tmp/mock/eval.md',
  }),
  feature('703', 'review-failure-and-close-recovery', {
    cardHeadline: { tone: 'warn', glyph: '⚠', verb: 'Close failed', owner: null, age: 7200, detail: 'Post-merge gate failed after review approval' },
    cardPresentation: {
      severity: 'error',
      contextLine: 'Post-merge gate failed after review approval.',
      timeline: [
        { label: 'Implemented', detail: 'CX', status: 'complete' },
        { label: 'Review approved', detail: 'CC', status: 'complete' },
        { label: 'Close failed', detail: 'post-merge gate', status: 'failed' },
      ],
      suppress: { closeFailurePanel: true, readyToClose: true },
      showRecoveryActions: true,
      compactAgents: true,
      agentSummary: 'CX implemented · CC reviewed',
    },
    agents: [agent('cx', 'ready', false)],
    validActions: [
      { action: 'feature-close-recover', label: 'Recover', priority: 'high', category: 'recovery', metadata: { recovery: true } },
      ...commonActions,
    ],
    lastCloseFailure: { message: 'post-merge gate failed' },
  }),
];

const research = [
  feature('21', 'adaptive-kanban-layout-options', {
    cardHeadline: { tone: 'running', glyph: '▶', verb: 'Researching', owner: 'cc', age: 940, detail: 'Comparing focus-lane and master-detail layouts' },
    agents: [agent('cc', 'implementing'), agent('gg', 'implementing'), agent('cx', 'waiting')],
    validActions: commonActions.map(a => ({ ...a, action: a.action.replace('feature', 'research') })),
  }),
  feature('22', 'progressive-disclosure-patterns', {
    stage: 'in-evaluation',
    lifecycle: 'in-evaluation',
    cardHeadline: { tone: 'attention', glyph: '◆', verb: 'Evaluation needs input', owner: 'cu', age: 360, detail: 'Evaluator is waiting for clarification' },
    agents: [agent('cu', 'waiting')],
    evalStatus: 'evaluating',
    evalSession: { running: true, session: 'mock-r22-eval' },
    validActions: [{ action: 'open-eval-session', label: 'Open Terminal', priority: 'high', category: 'session' }],
  }),
];

const payload = {
  generatedAt: now,
  summary: { implementing: 5, waiting: 2, complete: 0, error: 1, total: 5 },
  repos: [{
    path: '/tmp/aigon-dashboard-design-audit',
    displayPath: '~/src/design-audit',
    name: 'design-audit',
    features,
    research,
    feedback: [],
    sets: [{
      slug: 'dashboard-clarity',
      memberCount: 2,
      completed: 0,
      counts: { inbox: 0, backlog: 0, 'in-progress': 2, 'in-evaluation': 0, done: 0 },
      progress: { merged: 0, total: 2, percent: 0 },
      status: 'running',
      currentFeature: { id: '701', label: 'autonomous dashboard density redesign' },
      validActions: [{ action: 'set-autonomous-stop', label: 'Stop set', priority: 'high' }],
      depGraph: { nodes: [], edges: [] },
      autonomous: { status: 'running', running: true, sessionRunning: true, sessionName: 'mock-set-auto' },
    }],
  }],
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  await page.route('**/api/status', route => route.fulfill({ json: payload }));
  await page.route('**/api/sessions', route => route.fulfill({ json: { sessions: [] } }));
  await page.goto('http://127.0.0.1:4100');
  await page.click('#tab-pipeline');
  await page.waitForSelector('.kcard[data-feature-id="701"]');
  await page.screenshot({ path: '/tmp/aigon-current-feature-density.png', fullPage: true });
  await page.locator('.kanban-col[data-stage="in-progress"]').screenshot({ path: '/tmp/aigon-current-feature-column.png' });
  await page.getByText('Group by Set', { exact: true }).click();
  await page.waitForTimeout(300);
  await page.locator('.kanban-col[data-stage="in-progress"]').screenshot({ path: '/tmp/aigon-current-set-column.png' });
  await page.getByText('Research', { exact: true }).first().click();
  await page.waitForSelector('.kcard[data-feature-id="21"]');
  await page.screenshot({ path: '/tmp/aigon-current-research-density.png', fullPage: true });
  await browser.close();
})();
