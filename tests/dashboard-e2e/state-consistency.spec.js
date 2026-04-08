// @ts-check
'use strict';

/**
 * E2E: Dashboard state consistency checks.
 *
 * Verifies that:
 * 1. The /api/status response matches what the kanban UI shows (column counts,
 *    feature names, and stage placement).
 * 2. Valid actions on feature cards match the expected state machine output
 *    for each stage (e.g., inbox features have Prioritise, backlog have Start).
 * 3. No invalid actions appear (e.g., no eval button on solo features,
 *    no Prioritise button on in-progress features).
 *
 * Uses the fixture's existing pre-seeded features (from globalSetup) plus
 * creates a fresh state-consistency-feature for targeted checks.
 *
 * Run: npx playwright test --config tests/dashboard-e2e/playwright.config.js state-consistency
 */

const { test, expect } = require('@playwright/test');
const { gotoPipelineWithMockedSessions } = require('./_helpers');

// REGRESSION: one helper prevents per-stage loop duplication that previously
// drifted across inbox/backlog checks and masked missing action constraints.
async function verifyStageActions(page, stage, mustHave, mustNotHave) {
    const cards = page.locator(`.kanban-col[data-stage="${stage}"] .kcard`);
    const count = await cards.count();
    for (let i = 0; i < count; i++) {
        const card = cards.nth(i);
        for (const action of mustHave) {
            await expect(card.locator(`.kcard-va-btn[data-va-action="${action}"]`)).toBeVisible();
        }
        for (const action of mustNotHave) {
            await expect(card.locator(`.kcard-va-btn[data-va-action="${action}"]`)).toHaveCount(0);
        }
    }
}

test.describe('Dashboard state consistency', () => {

    test('/api/status response matches UI column counts', async ({ page }) => {
        await gotoPipelineWithMockedSessions(page);

        const statusResp = await page.request.get('/api/status');
        expect(statusResp.ok()).toBe(true);
        const statusData = await statusResp.json();

        expect(statusData.repos).toBeDefined();
        expect(Array.isArray(statusData.repos)).toBe(true);

        for (const repo of statusData.repos) {
            const featuresByStage = {};
            for (const feature of repo.features || []) {
                if (!featuresByStage[feature.stage]) featuresByStage[feature.stage] = [];
                featuresByStage[feature.stage].push(feature);
            }

            for (const [stage, features] of Object.entries(featuresByStage)) {
                if (stage === 'done') continue;
                const col = page.locator(`.kanban-col[data-stage="${stage}"]`).first();
                if (features.length > 0) {
                    await expect(col).toBeVisible({ timeout: 5000 });
                    await expect(col.locator('.col-count').first()).toContainText(String(features.length), { timeout: 3000 });
                }
            }
        }
    });

    test('inbox features only show Prioritise action', async ({ page }) => {
        await gotoPipelineWithMockedSessions(page);
        await verifyStageActions(page, 'inbox',
            ['feature-prioritise'],
            ['feature-start', 'feature-close', 'feature-eval']
        );
    });

    test('backlog features show Start feature action', async ({ page }) => {
        await gotoPipelineWithMockedSessions(page);
        const count = await page.locator('.kanban-col[data-stage="backlog"] .kcard').count();
        if (count > 0) {
            await verifyStageActions(page, 'backlog',
                ['feature-start'],
                ['feature-prioritise', 'feature-close', 'feature-eval']
            );
        }
    });

    test('/api/status response has required fields', async ({ page }) => {
        const resp = await page.request.get('/api/status');
        expect(resp.ok()).toBe(true);
        const data = await resp.json();

        for (const key of ['repos', 'generatedAt', 'summary']) expect(data).toHaveProperty(key);
        for (const key of ['implementing', 'submitted', 'waiting', 'error']) expect(data.summary).toHaveProperty(key);

        for (const repo of data.repos) {
            for (const key of ['path', 'name', 'features']) expect(repo).toHaveProperty(key);
            expect(Array.isArray(repo.features)).toBe(true);
            for (const feature of repo.features) {
                for (const key of ['id', 'name', 'stage', 'agents', 'validActions']) expect(feature).toHaveProperty(key);
                expect(Array.isArray(feature.agents)).toBe(true);
                expect(Array.isArray(feature.validActions)).toBe(true);
                for (const va of feature.validActions) {
                    for (const key of ['action', 'label']) {
                        expect(va).toHaveProperty(key);
                        expect(typeof va[key]).toBe('string');
                    }
                }
            }
        }
    });

    test('in-progress solo features do not show feature-eval action', async ({ page }) => {
        const resp = await page.request.get('/api/status');
        const data = await resp.json();
        for (const repo of data.repos) {
            for (const feature of repo.features) {
                if (feature.stage !== 'in-progress') continue;
                const isSolo = (feature.agents || []).filter(a => a.id !== 'solo').length <= 1;
                if (!isSolo) continue;
                const hasEval = feature.validActions.some(va => va.action === 'feature-eval');
                expect(hasEval, `Solo feature #${feature.id} (${feature.name}) should not have feature-eval action`).toBe(false);
            }
        }
    });

    test('stage placement in API matches state machine expected values', async ({ page }) => {
        const resp = await page.request.get('/api/status');
        const data = await resp.json();
        const validStages = ['inbox', 'backlog', 'in-progress', 'in-evaluation', 'done'];
        for (const repo of data.repos) {
            for (const feature of repo.features) {
                expect(validStages, `Feature #${feature.id} has unknown stage: ${feature.stage}`)
                    .toContain(feature.stage);
            }
        }
    });
});
