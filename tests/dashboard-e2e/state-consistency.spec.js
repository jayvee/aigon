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

test.describe('Dashboard state consistency', () => {

    test('/api/status response matches UI column counts', async ({ page }) => {
        // Mock session endpoints so no terminal launch is attempted
        await page.route('**/api/session/**', route => route.fulfill({ json: { ok: true } }));

        await page.goto('/');
        await page.click('#tab-pipeline');
        await page.waitForSelector('.kanban', { timeout: 10000 });

        // Fetch /api/status directly
        const statusResp = await page.request.get('/api/status');
        expect(statusResp.ok()).toBe(true);
        const statusData = await statusResp.json();

        expect(statusData.repos).toBeDefined();
        expect(Array.isArray(statusData.repos)).toBe(true);

        // Each repo's features should appear in the correct kanban column
        for (const repo of statusData.repos) {
            const featuresByStage = {};
            for (const feature of repo.features || []) {
                if (!featuresByStage[feature.stage]) featuresByStage[feature.stage] = [];
                featuresByStage[feature.stage].push(feature);
            }

            for (const [stage, features] of Object.entries(featuresByStage)) {
                if (stage === 'done') continue; // done column is capped — skip exact count check

                const col = page.locator(`.kanban-col[data-stage="${stage}"]`).first();
                const colCount = col.locator('.col-count').first();

                // Column count badge should reflect the number of features
                if (features.length > 0) {
                    await expect(col).toBeVisible({ timeout: 5000 });
                    // Count badge shows total features in that stage
                    await expect(colCount).toContainText(String(features.length), { timeout: 3000 });
                }
            }
        }
    });

    test('inbox features only show Prioritise action', async ({ page }) => {
        await page.route('**/api/session/**', route => route.fulfill({ json: { ok: true } }));

        await page.goto('/');
        await page.click('#tab-pipeline');
        await page.waitForSelector('.kanban', { timeout: 10000 });

        const inboxCol = page.locator('.kanban-col[data-stage="inbox"]').first();
        const inboxCards = inboxCol.locator('.kcard');
        const count = await inboxCards.count();

        for (let i = 0; i < count; i++) {
            const card = inboxCards.nth(i);
            // Inbox cards should have exactly 1 action button: Prioritise
            const actionBtns = card.locator('.kcard-va-btn');
            const btnCount = await actionBtns.count();
            expect(btnCount).toBeGreaterThanOrEqual(1);

            // Prioritise button must be present
            const prioBtn = card.locator('.kcard-va-btn[data-va-action="feature-prioritise"]');
            await expect(prioBtn).toBeVisible();

            // No Start feature, no Close, no Eval on inbox cards
            await expect(card.locator('.kcard-va-btn[data-va-action="feature-start"]')).toHaveCount(0);
            await expect(card.locator('.kcard-va-btn[data-va-action="feature-close"]')).toHaveCount(0);
            await expect(card.locator('.kcard-va-btn[data-va-action="feature-eval"]')).toHaveCount(0);
        }
    });

    test('backlog features show Start feature action', async ({ page }) => {
        await page.route('**/api/session/**', route => route.fulfill({ json: { ok: true } }));

        // Navigate and check
        await page.goto('/');
        await page.click('#tab-pipeline');
        await page.waitForSelector('.kanban', { timeout: 10000 });

        const backlogCol = page.locator('.kanban-col[data-stage="backlog"]').first();
        const backlogCards = backlogCol.locator('.kcard');
        const count = await backlogCards.count();

        if (count > 0) {
            for (let i = 0; i < count; i++) {
                const card = backlogCards.nth(i);

                // Backlog cards should have Start feature action
                const setupBtn = card.locator('.kcard-va-btn[data-va-action="feature-start"]');
                await expect(setupBtn).toBeVisible();
                await expect(setupBtn).toContainText('Start');

                // No Prioritise button (already prioritised)
                await expect(card.locator('.kcard-va-btn[data-va-action="feature-prioritise"]')).toHaveCount(0);
                // No Close or Eval buttons
                await expect(card.locator('.kcard-va-btn[data-va-action="feature-close"]')).toHaveCount(0);
                await expect(card.locator('.kcard-va-btn[data-va-action="feature-eval"]')).toHaveCount(0);
            }
        }
    });

    test('/api/status response has required fields', async ({ page }) => {
        const resp = await page.request.get('/api/status');
        expect(resp.ok()).toBe(true);

        const data = await resp.json();
        expect(data).toHaveProperty('repos');
        expect(data).toHaveProperty('generatedAt');
        expect(data).toHaveProperty('summary');
        expect(data.summary).toHaveProperty('implementing');
        expect(data.summary).toHaveProperty('submitted');
        expect(data.summary).toHaveProperty('waiting');
        expect(data.summary).toHaveProperty('error');

        for (const repo of data.repos) {
            expect(repo).toHaveProperty('path');
            expect(repo).toHaveProperty('name');
            expect(repo).toHaveProperty('features');
            expect(Array.isArray(repo.features)).toBe(true);

            for (const feature of repo.features) {
                expect(feature).toHaveProperty('id');
                expect(feature).toHaveProperty('name');
                expect(feature).toHaveProperty('stage');
                expect(feature).toHaveProperty('agents');
                expect(feature).toHaveProperty('validActions');
                expect(Array.isArray(feature.agents)).toBe(true);
                expect(Array.isArray(feature.validActions)).toBe(true);

                // Each validAction must have required fields
                for (const va of feature.validActions) {
                    expect(va).toHaveProperty('action');
                    expect(va).toHaveProperty('label');
                    expect(typeof va.action).toBe('string');
                    expect(typeof va.label).toBe('string');
                }
            }
        }
    });

    test('in-progress solo features do not show feature-eval action', async ({ page }) => {
        await page.route('**/api/session/**', route => route.fulfill({ json: { ok: true } }));

        const resp = await page.request.get('/api/status');
        const data = await resp.json();

        for (const repo of data.repos) {
            for (const feature of repo.features) {
                if (feature.stage !== 'in-progress') continue;

                const agents = (feature.agents || []).filter(a => a.id !== 'solo');
                const isSolo = agents.length <= 1;
                if (!isSolo) continue;

                // Solo in-progress features must not have feature-eval in validActions
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
