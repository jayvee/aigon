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

    test('solo implementing card separates live session tools from card actions', async ({ page }) => {
        await mountPreview(page, buildPayload({
            features: [baseRow('925', scenario('feature-implementing-solo_worktree'))],
        }));
        const card = page.locator('.kcard[data-feature-id="925"]');
        await expect(card.locator('.ccard-status-bar')).toHaveCount(1);
        await expect(card.locator('.ccard-peek')).toHaveCount(1);
        await expect(card.locator('.ccard-status-tools .ccard-session-open')).toHaveCount(1);
        await expect(card.locator('.ccard-overflow')).toHaveCount(2);
        await expect(card.locator('.ccard-actions')).toHaveCount(1);
        await expect(card.locator('.kcard-overflow-item')).toHaveCount(4);
        await expect(card.locator('.ccard-actions .kcard-overflow-item[data-va-action="feature-reset"]')).toHaveCount(1);
        await expect(card.locator('.ccard-actions .kcard-overflow-item[data-va-action="feature-nudge"]')).toHaveCount(1);
    });

    test('closing renders as card state rather than implementation-agent status', async ({ page }) => {
        await mountPreview(page, buildPayload({
            features: [baseRow('928', scenario('feature-closing-solo_worktree'))],
        }));
        const card = page.locator('.kcard[data-feature-id="928"]');
        await expect(card.locator('.ccard-state')).toHaveText('Closing');
        await expect(card.locator('.ccard-status-bar')).toHaveCount(0);
        await expect(card.locator('.ccard-blockers')).toHaveCount(0);
    });

    test('completed review row reports its outcome and aligns with primary status', async ({ page }) => {
        let openedSession = null;
        page.on('request', request => {
            if (request.url().endsWith('/api/session/view')) {
                openedSession = request.postDataJSON().sessionName;
            }
        });
        await mountPreview(page, buildPayload({
            features: [baseRow('926', scenario('feature-implementing-ready-solo'))],
        }));
        const card = page.locator('.kcard[data-feature-id="926"]');
        const review = card.locator('.ccard-row').filter({ hasText: 'OP' });
        const outcome = review.locator('.ccard-row-note');
        await expect(outcome).toHaveText('Implementation approved');
        expect(await outcome.evaluate(node => node.scrollWidth <= node.clientWidth && node.scrollHeight <= node.clientHeight)).toBe(true);
        await expect(review.locator('.ccard-dot')).toHaveClass(/is-ready/);
        await expect(review.locator('.ccard-peek')).toBeVisible();
        await expect(review.locator('.ccard-session-open')).toHaveAttribute('data-session-name', 'feature-implementing-ready-solo-review');
        await review.locator('.ccard-session-menu-toggle').click();
        await review.locator('.ccard-session-open').click();
        await expect.poll(() => openedSession).toBe('feature-implementing-ready-solo-review');
        await expect(card.locator('.ccard-status-main .ccard-row-name')).toHaveText('CC');
        await expect(review.locator('.ccard-row-name')).toHaveText('OP');
        const agentLefts = await card.locator('.ccard-status-main .ccard-row-name, .ccard-row .ccard-row-name').evaluateAll(nodes => (
            nodes.map(node => Math.round(node.getBoundingClientRect().left))
        ));
        const statusLefts = await card.locator('.ccard-status-label, .ccard-row-note').evaluateAll(nodes => (
            nodes.map(node => Math.round(node.getBoundingClientRect().left))
        ));
        expect(new Set(agentLefts).size).toBe(1);
        expect(new Set(statusLefts).size).toBe(1);
        const lefts = await card.locator('.ccard-state-dot, .ccard-row .ccard-dot').evaluateAll(nodes => (
            nodes.map(node => Math.round(node.getBoundingClientRect().left))
        ));
        expect(new Set(lefts).size).toBe(1);
        await expect(card.locator('.ccard-actions .ccard-action.is-primary')).toHaveText('Close');
        await expect(card.locator('.ccard-actions .ccard-action:not(.is-primary)')).toHaveText('Address review');
        await expect(card.locator('.ccard-actions .kcard-overflow-item[data-va-action="feature-code-review"]')).toHaveCount(1);
        await expect(card.locator('.ccard-actions .kcard-overflow-item[data-va-action="feature-reset"]')).toHaveCount(1);
        await expect(card.locator('.ccard-status-tools .kcard-overflow-item[data-va-action="feature-nudge"]')).toHaveCount(0);
        await expect(card.locator('.ccard-actions .kcard-overflow-item[data-va-action="feature-nudge"]')).toHaveCount(1);
        await expect(card.locator('.ccard-status-tools .kcard-overflow-item[data-va-action="feature-reset"]')).toHaveCount(0);
    });

    test('active review row names the in-progress work consistently', async ({ page }) => {
        await mountPreview(page, buildPayload({
            features: [baseRow('927', scenario('feature-code_review_in_progress-solo_worktree'))],
        }));
        const card = page.locator('.kcard[data-feature-id="927"]');
        const review = card.locator('.ccard-row').filter({ hasText: 'CX' });
        await expect(review.locator('.ccard-row-note')).toHaveText('Reviewing code');
        await expect(review).not.toContainText('code review');
        expect(await review.locator('.ccard-dot').evaluate(node => getComputedStyle(node).animationName)).toBe('ccard-active-pulse');
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
        await expect(header.locator('.ccard-kind')).toHaveText('Feature set');
        await expect(header.locator('.ccard-badge')).toHaveText('3');
        await expect(header.locator('.ccard-badge')).toHaveAttribute('aria-label', '3 features');

        // Conductor Peek lives inside its labeled pill; no bare unlabeled eyes.
        const conductorPill = header.locator('.ccard-pill.is-active').filter({ hasText: 'Conductor' });
        await expect(conductorPill.locator('.kcard-peek-btn')).toHaveCount(1);
        const barePeeks = await header
            .locator('.kcard-peek-btn:not(.ccard-pill .kcard-peek-btn):not(.ccard-stage .kcard-peek-btn):not(.ccard-row .kcard-peek-btn):not(.ccard-run-head .kcard-peek-btn)')
            .count();
        expect(barePeeks, 'no unlabeled eye buttons in the set header').toBe(0);

        // The header summarizes the set; member cards live in the stack.
        await expect(header.locator('.ccard-member')).toHaveCount(0);
        await expect(header.locator('.ccard-set-progress')).toContainText('1 of 3');
        await expect(header.locator('.ccard-set-current')).toContainText('F682');
        await expect(header.locator('.ccard-set-current .ccard-stage')).toHaveCount(4);

        // Peek dispatches through the shared terminal panel.
        await conductorPill.locator('.kcard-peek-btn').click();
        await expect(page.locator('#terminal-panel')).toBeVisible({ timeout: 5000 });
        await page.click('#panel-close');
    });

    test('inbox set stays compact in a narrow lane', async ({ page }) => {
        const setScenario = scenario('set-inbox-members');
        await page.setViewportSize({ width: 1440, height: 900 });
        await mountPreview(page, buildPayload({
            features: [
                baseRow('931', scenario('feature-inbox-solo_worktree'), { stage: 'inbox', set: 'autonomous-recovery' }),
                baseRow('932', scenario('feature-inbox-solo_worktree'), { stage: 'inbox', set: 'autonomous-recovery' }),
            ],
            sets: [{
                slug: 'autonomous-recovery',
                goal: 'Autonomous recovery',
                status: 'inbox',
                isComplete: false,
                completed: 0,
                memberCount: 3,
                progress: { merged: 0, total: 3, percent: 0 },
                validActions: setScenario.dashboardActions,
                uiContract: setScenario.contract,
            }],
        }));
        await page.getByRole('button', { name: 'Group by Set' }).click();

        const bundle = page.locator('.kanban-set-bundle').filter({ hasText: 'Autonomous recovery' }).first();
        await expect(bundle.locator('.ccard-kind')).toHaveText('Feature set');
        const setActions = bundle.locator(':scope > .kanban-set-bundle-head .ccard-feature-set > .ccard-actions');
        await expect(setActions.locator('.ccard-action.is-primary')).toHaveText('Prioritise set');
        await expect(bundle.locator('.kanban-set-toggle')).toHaveAttribute('aria-expanded', 'false');
        const metrics = await bundle.evaluate((element) => ({
            titleHeight: element.querySelector('.ccard-title').getBoundingClientRect().height,
            actionTops: [...element.querySelector(':scope > .kanban-set-bundle-head .ccard-feature-set > .ccard-actions').children]
                .map(node => Math.round(node.getBoundingClientRect().top)),
        }));
        expect(metrics.titleHeight).toBeLessThan(40);
        expect(new Set(metrics.actionTops).size).toBe(1);
    });

    test('manual set member is visible from the grouped in-progress header', async ({ page }) => {
        const setScenario = scenario('set-manual-running');
        await mountPreview(page, buildPayload({
            features: [baseRow('682', scenario('feature-implementing-solo_worktree'), {
                stage: 'in-progress',
                set: 'autonomous-recovery',
            })],
            sets: [{
                slug: 'autonomous-recovery',
                goal: 'Autonomous recovery',
                status: 'running',
                isComplete: false,
                completed: 1,
                memberCount: 3,
                currentFeature: { id: '682', label: 'Recover interrupted runs', stage: 'in-progress' },
                validActions: setScenario.dashboardActions,
                uiContract: setScenario.contract,
            }],
        }));
        await page.getByRole('button', { name: 'Group by Set' }).click();

        const bundle = page.locator('.kanban-set-bundle').filter({ hasText: 'Autonomous recovery' }).first();
        await expect(bundle.locator('.ccard-feature-set > .ccard-state')).toHaveText('In progress');
        await expect(bundle.locator('.ccard-set-current')).toContainText('F682');
        await expect(bundle.locator('.ccard-set-current')).toContainText('Implementing');
        await expect(bundle.locator('[data-va-action="set-autonomous-start"]')).toHaveCount(0);
        await expect(bundle.locator('[data-va-action="set-autonomous-stop"]')).toHaveCount(0);
    });

    // REGRESSION: a feature set spanning backlog and in-progress must not
    // duplicate its active-run summary in the backlog lane.
    test('set summary appears only in its authoritative workflow lane', async ({ page }) => {
        const setScenario = scenario('set-running');
        await mountPreview(page, buildPayload({
            features: [
                baseRow('681', scenario('feature-backlog-blocked'), {
                    stage: 'backlog',
                    set: 'autonomous-recovery',
                }),
                baseRow('682', scenario('feature-autonomous-running'), {
                    stage: 'in-progress',
                    set: 'autonomous-recovery',
                }),
            ],
            sets: [{
                slug: 'autonomous-recovery',
                goal: 'Autonomous recovery',
                status: 'running',
                isComplete: false,
                completed: 1,
                memberCount: 3,
                progress: { merged: 1, total: 3, percent: 33 },
                currentFeature: { id: '682', label: 'Recover interrupted runs', stage: 'in-progress' },
                validActions: setScenario.dashboardActions,
                autonomous: { status: 'running', running: true, sessionName: 'set-autonomous-recovery-auto' },
                uiContract: setScenario.contract,
            }],
        }));
        await page.getByRole('button', { name: 'Group by Set' }).click();

        const backlog = page.locator('.col-body[data-stage="backlog"] .kanban-set-bundle');
        const inProgress = page.locator('.col-body[data-stage="in-progress"] .kanban-set-bundle');
        await expect(backlog.locator('.kanban-set-lane-header')).toHaveCount(1);
        await expect(backlog.locator('.ccard-set-progress, .ccard-set-current, .ccard-pill')).toHaveCount(0);
        await expect(inProgress.locator('.kanban-set-header-contract')).toHaveCount(1);
        await expect(inProgress.locator('.ccard-set-progress')).toContainText('1 of 3');
        await expect(inProgress.locator('.ccard-set-current')).toContainText('F682');
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

    test('responsive pipeline fills the viewport and keeps compact session Peek visible @smoke', async ({ page }) => {
        await page.setViewportSize({ width: 1728, height: 1000 });
        await mountPreview(page, buildPayload({
            features: [
                baseRow('910', scenario('feature-inbox-solo_worktree'), { stage: 'inbox' }),
                baseRow('911', scenario('feature-spec_review_in_progress-solo_worktree'), { stage: 'backlog' }),
                baseRow('912', scenario('feature-autonomous-running'), { stage: 'in-progress' }),
            ],
        }));
        await expect(page.locator('.kanban--responsive')).toHaveCount(1);
        await expect(page.locator('.kanban-col[data-pipeline-column="backlog"] .ccard.is-compact')).toHaveCount(1);
        // REGRESSION: compact backlog cards must retain Peek for inspectable spec-review sessions.
        await expect(page.locator('.kcard[data-feature-id="911"] .ccard-peek[data-peek-session]')).toBeVisible();
        await expect(page.locator('.kanban-col[data-pipeline-column="in-progress"] .ccard.is-expanded')).toHaveCount(1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
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
