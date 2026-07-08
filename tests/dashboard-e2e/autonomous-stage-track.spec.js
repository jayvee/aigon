// @ts-check
'use strict';

/**
 * E2E: F492 autonomous stage track rendering.
 *
 * Mocks /api/status with a synthetic autonomousPlan and asserts the kanban
 * card renders the F492 vertical stage track with the correct markers,
 * verb-form headline labels, and audit-trail attribution. Three card states:
 *   - all stages complete (Stopped at <last-stage>),
 *   - mid-implement (Implementing),
 *   - non-autonomous (no track at all — regression).
 *
 * Pure-render test: no CLI, no engine, no real autonomous run. Speeds the
 * suite and isolates the rendering contract from the conductor.
 *
 * Run: npx playwright test --config tests/dashboard-e2e/playwright.config.js autonomous-stage-track
 */
const { test, expect } = require('@playwright/test');

const REPO_PATH = '/tmp/aigon-f492-mock-repo';

/**
 * Build a /api/status payload with one feature carrying the supplied stages.
 * Mirrors the lightweight shape the dashboard collector now emits per F492.
 */
function buildStatusPayload({ featureId, name, stage, autonomousPlan, autonomousController, headline, autonomousSession, agents }) {
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
                stage,
                lifecycle: stage,
                createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
                updatedAt: new Date().toISOString(),
                specPath: `/tmp/mock/docs/specs/features/03-in-progress/feature-${featureId}-${name}.md`,
                agents: agents || [],
                workflowEventCount: 0,
                detailFingerprint: featureId + '::' + name + '::mock',
                cardHeadline: headline || null,
                autonomousPlan: autonomousPlan || null,
                autonomousController: autonomousController || null,
                autonomousSession: autonomousSession || null,
                validActions: [],
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
    await page.goto('/');
    await page.click('#tab-pipeline');
    await page.waitForSelector('.kanban', { timeout: 10000 });
    await page.waitForSelector('.kcard[data-feature-id="' + payload.repos[0].features[0].id + '"]', { timeout: 10000 });
}

test.describe('F492 autonomous stage track', () => {
    test('all stages complete renders Stopped headline + every stage marked ✓', async ({ page }) => {
        const payload = buildStatusPayload({
            featureId: '900',
            name: 'mock-stopped',
            stage: 'in-progress',
            headline: { tone: 'ready', glyph: '✓', verb: 'Stopped at close', subject: null, owner: null, age: 12, detail: null },
            autonomousPlan: {
                mode: 'solo_worktree',
                workflowSlug: null,
                error: null,
                stages: [
                    { key: 'implement-0', type: 'implement', label: 'Implement', status: 'complete', agents: [{ id: 'cc', model: null, effort: null }] },
                    { key: 'review-1',    type: 'review',    label: 'Review',    status: 'complete', agents: [{ id: 'cu', model: null, effort: null }] },
                    { key: 'revision-2',  type: 'revision',  label: 'Revision',  status: 'complete', agents: [{ id: 'cc', model: null, effort: null }] },
                    { key: 'close-3',     type: 'close',     label: 'Close',     status: 'complete', agents: [] },
                ],
            },
            autonomousSession: { sessionName: 'mock-f900-auto-stopped', running: false, status: 'completed' },
            agents: [{ id: 'cc', status: 'ready', tmuxRunning: false, runtimeAgentId: 'cc' }],
        });
        await mountWithStatus(page, payload);

        const card = page.locator('.kcard[data-feature-id="900"]');
        await expect(card.locator('.kcard-headline-verb')).toHaveText('Stopped at close');
        const stages = card.locator('.kcard-stage-track .kcard-stage');
        await expect(stages).toHaveCount(4);
        for (let i = 0; i < 4; i++) {
            await expect(stages.nth(i)).toHaveClass(/is-complete/);
            await expect(stages.nth(i).locator('.kcard-stage-marker')).toHaveText('✓');
        }
        // Completed stages with agents inline the attribution. Renderer
        // resolves agent ids through AGENT_SHORT_NAMES so they surface as
        // upper-case codes (CC, CU) rather than the raw lower-case ids.
        await expect(stages.nth(0).locator('.kcard-stage-agent')).toContainText('CC');
        await expect(stages.nth(1).locator('.kcard-stage-agent')).toContainText('CU');
    });

    test('mid-implement renders Implementing headline + only implement marker ●', async ({ page }) => {
        const payload = buildStatusPayload({
            featureId: '901',
            name: 'mock-mid-implement',
            stage: 'in-progress',
            headline: { tone: 'running', glyph: '▶', verb: 'Implementing', subject: null, owner: 'cc', age: 840, detail: null },
            autonomousPlan: {
                mode: 'solo_worktree',
                workflowSlug: null,
                error: null,
                stages: [
                    { key: 'implement-0', type: 'implement', label: 'Implement', status: 'running',  agents: [{ id: 'cc', model: null, effort: null }] },
                    { key: 'review-1',    type: 'review',    label: 'Review',    status: 'waiting',  agents: [{ id: 'cu', model: null, effort: null }] },
                    { key: 'close-2',     type: 'close',     label: 'Close',     status: 'waiting',  agents: [] },
                ],
            },
            autonomousSession: { sessionName: 'mock-f901-auto-mid-implement', running: true, status: 'running' },
            agents: [{ id: 'cc', status: 'implementing', tmuxRunning: true, runtimeAgentId: 'cc' }],
        });
        await mountWithStatus(page, payload);

        const card = page.locator('.kcard[data-feature-id="901"]');
        await expect(card.locator('.kcard-headline-verb')).toHaveText('Implementing');
        const stages = card.locator('.kcard-stage-track .kcard-stage');
        await expect(stages).toHaveCount(3);
        await expect(stages.nth(0)).toHaveClass(/is-running/);
        await expect(stages.nth(0).locator('.kcard-stage-marker')).toHaveText('●');
        await expect(stages.nth(1)).toHaveClass(/is-waiting/);
        await expect(stages.nth(2)).toHaveClass(/is-waiting/);
        // Conductor peek button surfaces in the track header.
        await expect(card.locator('.kcard-stage-track [data-peek-session="mock-f901-auto-mid-implement"]')).toHaveCount(1);
    });

    test('non-autonomous card renders no stage track (regression)', async ({ page }) => {
        const payload = buildStatusPayload({
            featureId: '902',
            name: 'mock-drive-only',
            stage: 'in-progress',
            headline: { tone: 'running', glyph: '▶', verb: 'Implementing', subject: null, owner: 'solo', age: 60, detail: null },
            autonomousPlan: null,
            autonomousSession: null,
            agents: [{ id: 'solo', status: 'implementing', tmuxRunning: true, runtimeAgentId: 'solo' }],
        });
        await mountWithStatus(page, payload);

        const card = page.locator('.kcard[data-feature-id="902"]');
        await expect(card.locator('.kcard-headline-verb')).toHaveText('Implementing');
        await expect(card.locator('.kcard-stage-track')).toHaveCount(0);
        await expect(card.locator('.kcard-autonomous-plan')).toHaveCount(0);
    });

    test('failed controller renders authoritative card status without stage failure headline', async ({ page }) => {
        const payload = buildStatusPayload({
            featureId: '903',
            name: 'mock-controller-failed',
            stage: 'in-progress',
            headline: { tone: 'warn', glyph: '⚠', verb: 'Autonomous failed', subject: null, owner: null, age: 300, detail: 'Reviewer exited without signaling' },
            autonomousPlan: {
                mode: 'solo_worktree',
                workflowSlug: null,
                error: null,
                stages: [
                    { key: 'implement-0', type: 'implement', label: 'Implement', status: 'complete', agents: [{ id: 'cx', model: null, effort: null }] },
                    { key: 'review-1',    type: 'review',    label: 'Review',    status: 'failed',   agents: [{ id: 'gg', model: null, effort: null }] },
                ],
            },
            autonomousController: {
                status: 'failed',
                running: false,
                reason: 'review-exited-without-signal',
                reasonLabel: 'Reviewer exited without signaling',
                reasonCategory: 'reviewer-exited',
                recommendedRecoveryKind: 'rerun-review',
                sessionName: 'mock-f903-auto-failed',
                sessionRunning: false,
                updatedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
            },
            autonomousSession: { sessionName: 'mock-f903-auto-failed', running: false, status: 'failed' },
            agents: [{ id: 'cx', status: 'ready', tmuxRunning: false, runtimeAgentId: 'cx' }],
        });
        await mountWithStatus(page, payload);

        const card = page.locator('.kcard[data-feature-id="903"]');
        await expect(card.locator('.kcard-headline-verb')).toHaveText('Autonomous failed');
        await expect(card.locator('.kcard-headline-verb')).not.toHaveText('Review failed');
        await expect(card.locator('.kcard-headline-detail')).toContainText('Reviewer exited without signaling');
        await expect(card.locator('.kcard-headline-detail')).toContainText('session exited');
        await expect(card.locator('.kcard-controller-status')).toHaveCount(0);
    });

    test('running controller surfaces live workflow state instead of unknown', async ({ page }) => {
        const payload = buildStatusPayload({
            featureId: '906',
            name: 'mock-controller-running',
            stage: 'in-progress',
            headline: { tone: 'running', glyph: '▶', verb: 'Implementing', subject: null, owner: 'cu', age: 20, detail: null },
            autonomousPlan: {
                mode: 'solo_worktree',
                workflowSlug: null,
                error: null,
                stages: [
                    { key: 'implement-0', type: 'implement', label: 'Implement', status: 'running', agents: [{ id: 'cu', model: null, effort: null }] },
                ],
            },
            autonomousController: {
                status: 'running',
                running: true,
                reason: 'implementing',
                reasonLabel: 'Implementing',
                reasonCategory: 'running',
                recommendedRecoveryKind: 'manual',
                sessionName: 'mock-f906-auto-running',
                sessionRunning: true,
                workflowState: 'implementing',
                updatedAt: new Date(Date.now() - 20 * 1000).toISOString(),
            },
            autonomousSession: { sessionName: 'mock-f906-auto-running', running: true, status: 'running' },
            agents: [{ id: 'cu', status: 'implementing', tmuxRunning: true, runtimeAgentId: 'cu' }],
        });
        await mountWithStatus(page, payload);

        const card = page.locator('.kcard[data-feature-id="906"]');
        await expect(card.locator('.kcard-controller-title')).toHaveText('Autonomy running');
        await expect(card.locator('.kcard-controller-reason')).toHaveText('Implementing');
        await expect(card.locator('.kcard-controller-reason')).not.toHaveText('Unknown controller state');
        await expect(card.locator('.kcard-controller-meta')).toContainText('session live');
    });

    test('stopped-by-user controller reads as manual mode', async ({ page }) => {
        const payload = buildStatusPayload({
            featureId: '904',
            name: 'mock-controller-stopped',
            stage: 'in-progress',
            headline: { tone: 'ready', glyph: '✓', verb: 'Stopped at review', subject: null, owner: null, age: null, detail: null },
            autonomousPlan: {
                mode: 'solo_worktree',
                workflowSlug: null,
                error: null,
                stages: [
                    { key: 'implement-0', type: 'implement', label: 'Implement', status: 'complete', agents: [{ id: 'cx', model: null, effort: null }] },
                    { key: 'review-1',    type: 'review',    label: 'Review',    status: 'waiting',  agents: [{ id: 'gg', model: null, effort: null }] },
                ],
            },
            autonomousController: {
                status: 'stopped',
                running: false,
                reason: 'stopped-by-user',
                reasonLabel: 'Stopped by user',
                reasonCategory: 'stopped-by-user',
                sessionName: 'mock-f904-auto-stopped',
                sessionRunning: false,
                updatedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
            },
            autonomousSession: { sessionName: 'mock-f904-auto-stopped', running: false, status: 'stopped' },
            agents: [{ id: 'cx', status: 'ready', tmuxRunning: false, runtimeAgentId: 'cx' }],
        });
        await mountWithStatus(page, payload);

        const card = page.locator('.kcard[data-feature-id="904"]');
        await expect(card.locator('.kcard-controller-title')).toHaveText('Manual mode');
        await expect(card.locator('.kcard-controller-reason')).toHaveText('Taken over by operator');
        await expect(card.locator('.kcard-controller-status')).not.toHaveClass(/tone-warn/);
    });

    test('completed controller stays quiet on done cards', async ({ page }) => {
        const payload = buildStatusPayload({
            featureId: '905',
            name: 'mock-controller-completed',
            stage: 'done',
            headline: { tone: 'done', glyph: '✓', verb: 'Closed', subject: null, owner: null, age: 60, detail: null },
            autonomousPlan: null,
            autonomousController: {
                status: 'completed',
                running: false,
                reason: 'feature-closed',
                reasonLabel: 'Feature closed',
                reasonCategory: 'completed',
                sessionName: 'mock-f905-auto-completed',
                sessionRunning: false,
                updatedAt: new Date(Date.now() - 60 * 1000).toISOString(),
            },
            autonomousSession: { sessionName: 'mock-f905-auto-completed', running: false, status: 'completed' },
            agents: [],
        });
        await mountWithStatus(page, payload);

        const card = page.locator('.kcard[data-feature-id="905"]');
        await expect(card.locator('.kcard-headline-verb')).toHaveText('Closed');
        await expect(card.locator('.kcard-controller-status')).toHaveCount(0);
    });
});
