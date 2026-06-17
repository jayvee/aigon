// @ts-check
'use strict';
/**
 * E2E: critical dashboard action surfaces — F556 critical-action smoke suite.
 *
 * REGRESSION (load-bearing — do not weaken): the autonomous-start happy path
 * once broke because `templates/dashboard/js/actions-picker.js` referenced an
 * undeclared `AUTONOMOUS_AGENT_IDS` global. Opening the Start Autonomously modal
 * threw a ReferenceError inside the lazy-loaded action module's open(); the
 * dispatcher (actions.js → dispatchActionModule) swallowed it into the generic
 * toast "Action failed to load. Try refreshing the page." No test watched the
 * console while opening an action surface, so CI stayed green. Fix: 17c7fd8c.
 *
 * This suite opens every critical action surface the e2e fixture can expose and
 * asserts each opens cleanly: no browser console/page error and no generic
 * action-load failure toast. Every test is tagged @smoke so it runs under
 * `npm run test:browser:smoke` (the PR gate and the iterate-loop dashboard gate).
 *
 * The dashboard's "resolve and close" recovery surface is covered by the
 * existing close-failure-event.spec.js (@smoke), which seeds a real merge
 * conflict and verifies the Resolve & close button + failure details render.
 *
 * Run: npx playwright test --config tests/dashboard-e2e/playwright.config.js critical-actions
 */
const { test, expect } = require('@playwright/test');
const {
    gotoPipelineWithMockedSessions,
    watchBrowserErrors,
    assertActionSurfaceClean,
} = require('./_helpers');

const REPO_PATH = '/tmp/aigon-f556-mock-repo';

/**
 * Build a minimal /api/status payload with a single in-progress feature whose
 * validActions render the requested action buttons. Mirrors the lightweight
 * card shape the dashboard collector emits; mirrors autonomous-stage-track's
 * mock approach so eval/close surfaces are deterministic without orchestrating
 * a real fleet (which the fixture cannot expose deterministically per-test).
 */
function buildStatusPayload({ featureId, name, agents, validActions }) {
    return {
        generatedAt: new Date().toISOString(),
        summary: { implementing: 1, waiting: 0, complete: 0, error: 0, total: 1 },
        repos: [{
            path: REPO_PATH,
            displayPath: '/tmp/mock',
            name: 'mock',
            githubRemote: false,
            features: [{
                id: featureId,
                name,
                stage: 'in-progress',
                lifecycle: 'in-progress',
                createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
                updatedAt: new Date().toISOString(),
                specPath: `/tmp/mock/docs/specs/features/03-in-progress/feature-${featureId}-${name}.md`,
                agents: agents || [],
                workflowEventCount: 0,
                detailFingerprint: featureId + '::' + name + '::mock',
                cardHeadline: null,
                autonomousPlan: null,
                autonomousSession: null,
                validActions: validActions || [],
                nextAction: null,
                nextActions: [],
                reviewSessionSummary: [],
                specReviewSessions: [],
                specRevisionSessions: [],
                specCheckSessions: [],
                nudges: [],
                stateRenderMeta: { badge: null, cls: '', label: '' },
            }],
            research: [],
            feedback: [],
            sets: [],
        }],
    };
}

async function mountWithStatus(page, payload) {
    await page.route('**/api/status', route => route.fulfill({ json: payload }));
    await page.route('**/api/sessions', route => route.fulfill({ json: { sessions: [] } }));
    await page.route('**/api/session/**', route => route.fulfill({ json: { ok: true, pid: 0 } }));
    // The synthetic card's repoPath is not a repo the live e2e server knows, so
    // the agent picker's support fetches (settings + spec recommendation) would
    // 403 and surface a console "Failed to load resource" error. Route them to
    // benign empties so the surface opens cleanly. NOTE: we deliberately do NOT
    // route /js/actions/** — a failed action-module script load is the F556
    // incident itself and must stay observable.
    await page.route('**/api/settings**', route => route.fulfill({ json: { settings: [] } }));
    await page.route('**/api/recommendation/**', route => route.fulfill({ json: { resolved: null, ranked: [] } }));
    await page.goto('/');
    await page.click('#tab-pipeline');
    await page.waitForSelector('.kanban', { timeout: 10000 });
    await page.waitForSelector('.kcard[data-feature-id="' + payload.repos[0].features[0].id + '"]', { timeout: 10000 });
}

test.describe('Critical dashboard action surfaces @smoke', () => {
    test('feature-start opens the agent picker without errors', async ({ page }) => {
        const watch = watchBrowserErrors(page);
        await gotoPipelineWithMockedSessions(page);

        const startBtn = page.locator('.kcard-va-btn[data-va-action="feature-start"]').first();
        await expect(startBtn, 'fixture should include a startable backlog feature').toBeVisible();
        await startBtn.click();

        // start.js is lazy-loaded on first click; the picker is its surface.
        await expect(page.locator('#agent-picker')).toBeVisible({ timeout: 10000 });
        await assertActionSurfaceClean(page, watch, 'feature-start');
    });

    test('start.js module is not fetched until a Start action is clicked', async ({ page }) => {
        // REGRESSION F519: dynamic import() must not prefetch modal modules on
        // page load. Folded in from the former action-lazy-load.spec.js.
        const requested = [];
        await page.route('**/js/actions/**', (route) => {
            requested.push(route.request().url());
            route.continue();
        });

        await gotoPipelineWithMockedSessions(page);
        const startModuleHits = requested.filter((u) => u.includes('/js/actions/start.js'));
        expect(startModuleHits, 'start.js must not load on initial dashboard paint').toHaveLength(0);

        const startBtn = page.locator('.kcard-va-btn[data-va-action="feature-start"]').first();
        await expect(startBtn, 'fixture should include a startable backlog feature').toBeVisible();
        await startBtn.click();
        await page.waitForResponse((res) => res.url().includes('/js/actions/start.js') && res.status() === 200, { timeout: 10000 });
        expect(requested.some((u) => u.includes('/js/actions/start.js'))).toBeTruthy();
    });

    test('feature-autonomous-start opens the Start Autonomously modal without errors', async ({ page }) => {
        // REGRESSION F556: this is the exact path the AUTONOMOUS_AGENT_IDS
        // incident broke. The error watch + generic-toast assertion is what
        // makes this path load-bearing for future refactors.
        const watch = watchBrowserErrors(page);
        await gotoPipelineWithMockedSessions(page);

        await page.evaluate(() => {
            const btn = document.querySelector('[data-va-action="feature-autonomous-start"]');
            if (!btn) throw new Error('fixture missing feature-autonomous-start action');
            btn.click();
        });

        await expect(page.locator('#autonomous-modal')).toBeVisible({ timeout: 10000 });
        await assertActionSurfaceClean(page, watch, 'feature-autonomous-start');
        // Belt-and-braces: the specific incident signature must never reappear.
        expect(watch.errors.join('\n')).not.toContain('AUTONOMOUS_AGENT_IDS');
    });

    test('feature-eval opens the evaluation agent picker without errors', async ({ page }) => {
        // The fixture cannot deterministically expose an in-evaluation fleet card
        // per-test (it depends on agent-ready orchestration across spec files), so
        // we mock /api/status with a two-agent in-progress card whose validActions
        // include feature-eval — exactly the data the renderer needs to show the
        // button. eval.js open() opens the shared agent picker as its surface.
        const watch = watchBrowserErrors(page);
        await mountWithStatus(page, buildStatusPayload({
            featureId: '951',
            name: 'mock-eval',
            agents: [
                { id: 'cc', status: 'ready', tmuxRunning: false, runtimeAgentId: 'cc' },
                { id: 'gg', status: 'ready', tmuxRunning: false, runtimeAgentId: 'gg' },
            ],
            validActions: [{ action: 'feature-eval', label: 'Evaluate', priority: 'high' }],
        }));

        const evalBtn = page.locator('.kcard[data-feature-id="951"] .kcard-va-btn[data-va-action="feature-eval"]');
        await expect(evalBtn).toBeVisible({ timeout: 5000 });
        await evalBtn.click();

        await expect(page.locator('#agent-picker')).toBeVisible({ timeout: 10000 });
        await assertActionSurfaceClean(page, watch, 'feature-eval');
    });

    test('feature-close opens the close modal without errors', async ({ page }) => {
        // Two-agent (fleet) card so close.js open() routes to showCloseModal()
        // and opens #close-modal as its surface (it dispatches no action until
        // the user confirms a winner, so this opens-only check is mutation-free).
        const watch = watchBrowserErrors(page);
        await mountWithStatus(page, buildStatusPayload({
            featureId: '952',
            name: 'mock-close',
            agents: [
                { id: 'cc', status: 'ready', tmuxRunning: false, runtimeAgentId: 'cc' },
                { id: 'gg', status: 'ready', tmuxRunning: false, runtimeAgentId: 'gg' },
            ],
            validActions: [{ action: 'feature-close', label: 'Close', priority: 'high' }],
        }));

        const closeBtn = page.locator('.kcard[data-feature-id="952"] .kcard-va-btn[data-va-action="feature-close"]');
        await expect(closeBtn).toBeVisible({ timeout: 5000 });
        await closeBtn.click();

        await expect(page.locator('#close-modal')).toBeVisible({ timeout: 10000 });
        await assertActionSurfaceClean(page, watch, 'feature-close');
    });
});
