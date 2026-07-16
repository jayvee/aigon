// @ts-check
'use strict';

/**
 * E2E: F682 production contract card renderer.
 *
 * Mounts /api/status payloads whose rows carry REAL contracts from the gallery
 * builder (lib/dashboard-card-gallery) — the same shape the collector ships.
 *
 * Boundary guarantees under test:
 *  - action buttons resolve through the same validActions lookup and
 *    handleFeatureAction dispatch as before (agent picker opens);
 *  - session Peek (live and completed/snapshot) opens the shared terminal
 *    panel — no alternate session path;
 *  - set headers render from the set contract: title once, spec-cycle status
 *    from contract facts with Peek inside its labeled pill, and no bare
 *    unlabeled eye buttons.
 */

const { test, expect } = require('@playwright/test');
const { watchBrowserErrors, assertActionSurfaceClean } = require('./_helpers');
const { buildDashboardCardGallery } = require('../../lib/dashboard-card-gallery');
const { buildMonitorOperationalProjection } = require('../../lib/monitor-operational-projection');

const REPO_PATH = '/tmp/aigon-f679-mock-repo';
const gallery = buildDashboardCardGallery();

function scenario(key) {
    const match = gallery.scenarios.find(item => item.key === key);
    if (!match) throw new Error(`gallery scenario missing: ${key}`);
    return match;
}

function baseRow(id, scenarioItem, overrides = {}) {
    const contract = scenarioItem.contract;
    return {
        id: String(id),
        name: contract.entity.name,
        stage: scenarioItem.lane === 'in-evaluation' ? 'in-evaluation' : (scenarioItem.lane || 'in-progress'),
        lifecycle: scenarioItem.state,
        currentSpecState: scenarioItem.state,
        mode: scenarioItem.mode === 'fleet' ? 'fleet' : 'solo_worktree',
        createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        updatedAt: new Date().toISOString(),
        specPath: `${REPO_PATH}/docs/specs/features/03-in-progress/feature-${id}-mock.md`,
        agents: (contract.agents || []).map(agent => ({ ...agent })),
        workflowEventCount: 0,
        detailFingerprint: `${id}::${scenarioItem.key}`,
        cardHeadline: null,
        autonomousPlan: null,
        autonomousSession: null,
        validActions: scenarioItem.dashboardActions,
        nextAction: null,
        nextActions: [],
        reviewSessionSummary: [],
        specReviewSessions: [],
        specRevisionSessions: [],
        specCheckSessions: [],
        nudges: [],
        stateRenderMeta: { badge: null, cls: '', label: scenarioItem.stateLabel || '' },
        uiContract: contract,
        ...overrides,
    };
}

function buildPayload({ features = [], research = [], sets = [] } = {}) {
    const repos = [{
        path: REPO_PATH,
        displayPath: '/tmp/mock',
        name: 'mock',
        githubRemote: false,
        features,
        research,
        feedback: [],
        sets,
    }];
    return {
        generatedAt: new Date().toISOString(),
        summary: { implementing: features.length, waiting: 0, complete: 0, error: 0, total: features.length },
        repos,
        monitorOperational: buildMonitorOperationalProjection(repos),
    };
}

async function mountPreview(page, payload) {
    await page.route('**/api/status', route => route.fulfill({ json: payload }));
    await page.route('**/api/sessions', route => route.fulfill({ json: { sessions: [] } }));
    await page.route('**/api/session/**', route => route.fulfill({ json: { ok: true, pid: 0 } }));
    await page.route('**/api/settings**', route => route.fulfill({ json: { settings: [] } }));
    await page.route('**/api/recommendation/**', route => route.fulfill({ json: { resolved: null, ranked: [] } }));
    await page.goto('/');
    await page.click('#tab-pipeline');
    await page.waitForSelector('.kanban', { timeout: 10000 });
}

async function mountMonitor(page, payload) {
    await page.route('**/api/status', route => route.fulfill({ json: payload }));
    await page.route('**/api/sessions', route => route.fulfill({ json: { sessions: [] } }));
    await page.route('**/api/session/**', route => route.fulfill({ json: { ok: true, pid: 0 } }));
    await page.route('**/api/settings**', route => route.fulfill({ json: { settings: [] } }));
    await page.route('**/api/recommendation/**', route => route.fulfill({ json: { resolved: null, ranked: [] } }));
    await page.goto('/');
    await page.click('#tab-monitor');
    await page.waitForSelector('#monitor-live-root:not([hidden])', { timeout: 10000 });
}

test.describe('Contract card production renderer @smoke', () => {
    test('renders contract bodies once per entity with plain language', async ({ page }) => {
        const watch = watchBrowserErrors(page);
        await mountPreview(page, buildPayload({
            features: [
                baseRow('901', scenario('feature-fleet-in-progress')),
                baseRow('902', scenario('feature-review-session-lost')),
                baseRow('903', scenario('feature-autonomous-reviewing')),
            ],
        }));
        await expect(page.locator('.kcard-contract')).toHaveCount(3);

        for (const id of ['901', '902', '903']) {
            const card = page.locator(`.kcard[data-feature-id="${id}"]`);
            await expect(card.locator('.ccard-title'), `card ${id} has exactly one title`).toHaveCount(1);
            const text = await card.innerText();
            expect(text, `card ${id} must not shout machine phase labels`).not.toMatch(/\b(NOW|NEXT|COMPLETE|FEATURE)\b/);
        }

        // Failure scenario: lost review session stays inspectable.
        const lost = page.locator('.kcard[data-feature-id="902"]');
        await expect(lost.locator('.ccard-peek[data-peek-session]')).toHaveCount(1);

        // Autonomous scenario: controller above stages, stable stage grid, no
        // duplicated worker rows outside the plan.
        const auto = page.locator('.kcard[data-feature-id="903"]');
        await expect(auto.locator('.ccard-run-head')).toHaveCount(1);
        await expect(auto.locator('.ccard-stage')).toHaveCount(4);
        await expect(auto.locator('.ccard-row')).toHaveCount(0);
        const rights = await auto.locator('.ccard-stage-status').evaluateAll(nodes => nodes.map(n => Math.round(n.getBoundingClientRect().right)));
        expect(new Set(rights).size, 'stage status column aligns across stages').toBe(1);

        await assertActionSurfaceClean(page, watch, 'contract-preview-render');
    });

    test('contract primary action dispatches through the shared action path', async ({ page }) => {
        const watch = watchBrowserErrors(page);
        await mountPreview(page, buildPayload({
            features: [baseRow('904', scenario('feature-implementing-ready-fleet'))],
        }));
        const evalBtn = page.locator('.kcard[data-feature-id="904"] .ccard-action.is-primary[data-va-action="feature-eval"]');
        await expect(evalBtn).toBeVisible({ timeout: 5000 });
        await evalBtn.click();
        await expect(page.locator('#agent-picker')).toBeVisible({ timeout: 10000 });
        await assertActionSurfaceClean(page, watch, 'contract feature-eval');
    });

    test('solo implementing card has one Peek and one overflow without an empty footer', async ({ page }) => {
        await mountPreview(page, buildPayload({
            features: [baseRow('925', scenario('feature-implementing-solo_worktree'))],
        }));
        const card = page.locator('.kcard[data-feature-id="925"]');
        await expect(card.locator('.ccard-status-bar')).toHaveCount(1);
        await expect(card.locator('.ccard-peek')).toHaveCount(1);
        await expect(card.locator('.ccard-overflow')).toHaveCount(1);
        await expect(card.locator('.ccard-actions')).toHaveCount(0);
        await expect(card.locator('.ccard-overflow-item')).toHaveCount(4);
    });

    test('recovery scenario promotes the recovery action to primary', async ({ page }) => {
        await mountPreview(page, buildPayload({
            features: [baseRow('905', scenario('feature-autonomous-review-failed'))],
        }));
        const card = page.locator('.kcard[data-feature-id="905"]');
        await expect(card.locator('.ccard.is-severity-error')).toHaveCount(1);
        const primary = card.locator('.ccard-action.is-primary');
        await expect(primary).toHaveAttribute('data-va-action', /autonomous-recover|feature-cancel-code-review/);
    });

    test('Peek on completed and running sessions opens the shared terminal panel', async ({ page }) => {
        await mountPreview(page, buildPayload({
            features: [baseRow('906', scenario('feature-autonomous-reviewing'))],
        }));
        const card = page.locator('.kcard[data-feature-id="906"]');

        const snapshotPeek = card.locator('.ccard-stage.is-complete .ccard-peek[data-peek-mode="snapshot"]').first();
        await expect(snapshotPeek).toBeVisible();
        await snapshotPeek.click();
        await expect(page.locator('#terminal-panel')).toBeVisible({ timeout: 5000 });
        await page.click('#panel-close');

        const livePeek = card.locator('.ccard-stage.is-running .ccard-peek[data-peek-mode="live"]').first();
        await livePeek.click();
        await expect(page.locator('#terminal-panel')).toBeVisible({ timeout: 5000 });
        await page.click('#panel-close');
    });

    test('research cards share the primitives with research vocabulary', async ({ page }) => {
        const watch = watchBrowserErrors(page);
        await mountPreview(page, buildPayload({
            research: [baseRow('204', scenario('research-fleet-in-progress'), {
                specPath: `${REPO_PATH}/docs/specs/research-topics/03-in-progress/research-204-mock.md`,
            })],
        }));
        await page.getByRole('button', { name: 'Research', exact: true }).first().click();
        const card = page.locator('.kcard[data-feature-id="204"]');
        await expect(card.locator('.ccard-research')).toHaveCount(1);
        await expect(card.locator('.ccard-title')).toHaveCount(1);
        await expect(card.locator('.ccard-row')).toHaveCount(2);
        await assertActionSurfaceClean(page, watch, 'contract research render');
    });

    test('set header renders from the set contract with labeled Peek only', async ({ page }) => {
        const setScenario = scenario('set-running');
        const memberScenario = scenario('feature-autonomous-running');
        await mountPreview(page, buildPayload({
            features: [baseRow('682', memberScenario, { set: 'autonomous-recovery' })],
            sets: [{
                slug: 'autonomous-recovery',
                goal: 'Autonomous recovery',
                status: 'running',
                isComplete: false,
                completed: 1,
                memberCount: 3,
                progress: { merged: 1, total: 3, percent: 33 },
                validActions: setScenario.dashboardActions,
                autonomous: { status: 'running', running: true, sessionName: 'set-autonomous-recovery-auto' },
                uiContract: setScenario.contract,
            }],
        }));
        await page.getByRole('button', { name: 'Group by Set' }).click();

        const header = page.locator('.kanban-set-header-contract');
        await expect(header).toHaveCount(1);
        await expect(header.locator('.ccard-title')).toHaveCount(1);
        await expect(header.locator('.ccard-title')).toHaveText('Autonomous recovery');

        // Conductor Peek lives inside its labeled pill; no bare unlabeled eyes.
        const conductorPill = header.locator('.ccard-pill.is-active').filter({ hasText: 'Conductor' });
        await expect(conductorPill.locator('.kcard-peek-btn')).toHaveCount(1);
        const barePeeks = await header
            .locator('.kcard-peek-btn:not(.ccard-pill .kcard-peek-btn):not(.ccard-stage .kcard-peek-btn):not(.ccard-row .kcard-peek-btn):not(.ccard-run-head .kcard-peek-btn)')
            .count();
        expect(barePeeks, 'no unlabeled eye buttons in the set header').toBe(0);

        // Member list in the header plus full stack cards beneath.
        await expect(header.locator('.ccard-member').count()).resolves.toBeGreaterThan(0);
        await expect(header.locator('.ccard-set-progress')).toContainText('1 of 3');
        await expect(header.locator('.ccard-set-current')).toContainText('F682');
        await expect(header.locator('.ccard-set-current .ccard-stage')).toHaveCount(4);

        // Peek dispatches through the shared terminal panel.
        await conductorPill.locator('.kcard-peek-btn').click();
        await expect(page.locator('#terminal-panel')).toBeVisible({ timeout: 5000 });
        await page.click('#panel-close');
    });

    test('responsive pipeline keeps kanban columns in one horizontal row @smoke', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        await mountPreview(page, buildPayload({
            features: [
                baseRow('915', scenario('feature-inbox-solo_worktree'), { stage: 'inbox' }),
                baseRow('916', scenario('feature-backlog-blocked'), { stage: 'backlog' }),
                baseRow('917', scenario('feature-autonomous-running'), { stage: 'in-progress' }),
                baseRow('918', scenario('feature-evaluation-session-running'), { stage: 'in-evaluation' }),
                baseRow('919', scenario('feature-implementing-ready-solo'), { stage: 'done' }),
            ],
        }));
        const layout = await page.locator('.kanban').first().evaluate((board) => {
            const cols = [...board.querySelectorAll('.kanban-col')];
            if (cols.length < 2) return { ok: false, colCount: cols.length };
            const tops = cols.map((c) => Math.round(c.getBoundingClientRect().top));
            return { ok: new Set(tops).size === 1, colCount: cols.length };
        });
        expect(layout.ok, `expected ${layout.colCount} columns on one row`).toBe(true);
    });

    test('responsive pipeline fills the viewport and matches stage density @smoke', async ({ page }) => {
        await page.setViewportSize({ width: 1728, height: 1000 });
        await mountPreview(page, buildPayload({
            features: [
                baseRow('910', scenario('feature-inbox-solo_worktree'), { stage: 'inbox' }),
                baseRow('911', scenario('feature-backlog-blocked'), { stage: 'backlog' }),
                baseRow('912', scenario('feature-autonomous-running'), { stage: 'in-progress' }),
            ],
        }));
        await expect(page.locator('.kanban--responsive')).toHaveCount(1);
        await expect(page.locator('.kanban-col[data-pipeline-column="backlog"] .ccard.is-compact')).toHaveCount(1);
        await expect(page.locator('.kanban-col[data-pipeline-column="in-progress"] .ccard.is-expanded')).toHaveCount(1);
        const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
        expect(fits).toBe(true);
        const wrap = page.locator('.wrap');
        await expect(wrap).toHaveClass(/wrap--operational/);
    });

    test('responsive pipeline has no horizontal overflow at 390px mobile @smoke', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await mountPreview(page, buildPayload({
            features: [
                baseRow('913', scenario('feature-autonomous-running'), { stage: 'in-progress' }),
                baseRow('914', scenario('set-running'), { stage: 'in-progress', set: 'autonomous-recovery' }),
            ],
            sets: [{
                slug: 'autonomous-recovery',
                goal: 'Autonomous recovery',
                status: 'running',
                isComplete: false,
                completed: 1,
                memberCount: 3,
                progress: { merged: 1, total: 3, percent: 33 },
                validActions: scenario('set-running').dashboardActions,
                autonomous: { status: 'running', running: true, sessionName: 'set-autonomous-recovery-auto' },
                uiContract: scenario('set-running').contract,
            }],
        }));
        await page.getByRole('button', { name: 'Group by Set' }).click();
        await expect(page.locator('.kanban--responsive')).toHaveCount(1);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
        expect(overflow).toBe(false);
        await expect(page.locator('.kanban-set-header-contract .ccard-stage .kcard-peek-btn').first()).toBeVisible();
    });

    test('live monitor renders operational groups @smoke', async ({ page }) => {
        await mountMonitor(page, buildPayload({
            features: [
                baseRow('920', scenario('feature-agent-needs-attention')),
                baseRow('921', scenario('feature-autonomous-fleet-running')),
            ],
        }));
        await expect(page.locator('#monitor-live-root')).toBeVisible();
        await expect(page.locator('.monitor-item.attention')).toHaveCount(1);
        await expect(page.locator('.monitor-section-label', { hasText: 'RUNNING' })).toBeVisible();
        await expect(page.locator('.monitor-focus .ccard-run, .monitor-focus .ccard-rows')).toHaveCount(1, { timeout: 5000 });
        await expect(page.locator('.monitor-summary .monitor-stat')).toHaveCount(4);
    });

    test('live monitor has no horizontal overflow at 390px @smoke', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await mountMonitor(page, buildPayload({
            features: [baseRow('922', scenario('feature-autonomous-running'))],
        }));
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
        expect(overflow).toBe(false);
        await page.locator('.monitor-item .monitor-item-copy').first().click();
        await expect(page.locator('.monitor-live-root')).toHaveAttribute('data-mobile-detail', 'true');
        await expect(page.locator('.monitor-focus')).toBeVisible();
        await page.locator('[data-monitor-back]').click();
        await expect(page.locator('.monitor-queue')).toBeVisible();
    });

    test('live monitor queue action dispatches through validActions @smoke', async ({ page }) => {
        await mountMonitor(page, buildPayload({
            features: [baseRow('924', scenario('feature-implementing-ready-fleet'))],
        }));
        const actionBtn = page.locator('.monitor-item .ccard-action[data-va-action="feature-eval"]').first();
        await expect(actionBtn).toBeVisible({ timeout: 5000 });
        await actionBtn.click();
        await expect(page.locator('#agent-picker')).toBeVisible({ timeout: 10000 });
    });
});
