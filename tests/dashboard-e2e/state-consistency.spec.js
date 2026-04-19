// @ts-check
'use strict';

/**
 * E2E: Dashboard state consistency.
 *
 * REGRESSION: prevents drift between /api/status and the kanban UI, and
 * prevents invalid-action buttons from appearing on feature cards (e.g. eval
 * button on solo features, Prioritise on in-progress). Per-stage looping kept
 * in one place so checks don't drift like they did before the 2026-04-01 audit.
 *
 * Uses the fixture's pre-seeded features (from globalSetup).
 */

const { test, expect } = require('@playwright/test');
const { gotoPipelineWithMockedSessions } = require('./_helpers');

const STAGE_ACTIONS = [
    { stage: 'inbox',   must: ['feature-prioritise'], mustNot: ['feature-start', 'feature-close', 'feature-eval'] },
    { stage: 'backlog', must: ['feature-start'],      mustNot: ['feature-prioritise', 'feature-close', 'feature-eval'] },
];

test.describe('Dashboard state consistency', () => {
    test('/api/status column counts match UI + response has required fields', async ({ page }) => {
        await gotoPipelineWithMockedSessions(page);

        const resp = await page.request.get('/api/status');
        expect(resp.ok()).toBe(true);
        const data = await resp.json();

        for (const key of ['repos', 'generatedAt', 'summary']) expect(data).toHaveProperty(key);
        for (const key of ['implementing', 'submitted', 'waiting', 'error']) expect(data.summary).toHaveProperty(key);

        for (const repo of data.repos) {
            for (const key of ['path', 'name', 'features']) expect(repo).toHaveProperty(key);
            expect(Array.isArray(repo.features)).toBe(true);
            const byStage = {};
            for (const f of repo.features) {
                for (const key of ['id', 'name', 'stage', 'agents', 'validActions']) expect(f).toHaveProperty(key);
                expect(Array.isArray(f.agents)).toBe(true);
                expect(Array.isArray(f.validActions)).toBe(true);
                for (const va of f.validActions) {
                    for (const key of ['action', 'label']) expect(typeof va[key]).toBe('string');
                }
                (byStage[f.stage] = byStage[f.stage] || []).push(f);
            }
            for (const [stage, list] of Object.entries(byStage)) {
                if (stage === 'done' || list.length === 0) continue;
                const col = page.locator(`.kanban-col[data-stage="${stage}"]`).first();
                await expect(col).toBeVisible({ timeout: 5000 });
                await expect(col.locator('.col-count').first()).toContainText(String(list.length), { timeout: 3000 });
            }
        }
    });

    for (const { stage, must, mustNot } of STAGE_ACTIONS) {
        test(`${stage} features show only expected actions`, async ({ page }) => {
            await gotoPipelineWithMockedSessions(page);
            // Skip read-only legacy cards (missing-workflow snapshot). They carry
            // a .compat-badge and only expose spec-review actions; the must/mustNot
            // contract only applies to snapshot-backed cards.
            const cards = page.locator(`.kanban-col[data-stage="${stage}"] .kcard:not(:has(.compat-badge))`);
            const count = await cards.count();
            for (let i = 0; i < count; i++) {
                const card = cards.nth(i);
                for (const a of must) await expect(card.locator(`.kcard-va-btn[data-va-action="${a}"]`)).toBeVisible();
                for (const a of mustNot) await expect(card.locator(`.kcard-va-btn[data-va-action="${a}"]`)).toHaveCount(0);
            }
        });
    }

    test('in-progress solo features never expose feature-eval', async ({ page }) => {
        const resp = await page.request.get('/api/status');
        const data = await resp.json();
        const VALID_STAGES = ['inbox', 'backlog', 'in-progress', 'in-evaluation', 'done'];
        for (const repo of data.repos) {
            for (const f of repo.features) {
                expect(VALID_STAGES, `Feature #${f.id} stage: ${f.stage}`).toContain(f.stage);
                if (f.stage !== 'in-progress') continue;
                const isSolo = (f.agents || []).filter(a => a.id !== 'solo').length <= 1;
                if (!isSolo) continue;
                const hasEval = f.validActions.some(va => va.action === 'feature-eval');
                expect(hasEval, `Solo #${f.id} (${f.name}) should not have feature-eval`).toBe(false);
            }
        }
    });
});
