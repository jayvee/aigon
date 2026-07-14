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

// Post-F296: inbox specs are snapshot-backed from create time onward. Rows
// that truly lack engine state still surface MISSING_SNAPSHOT; inbox/backlog
// folder positions still get pre-engine actions from the read model. The
// dashboard supports `paused` in the API, but the column stays
// hidden unless the UI toggle is enabled.
test.describe('Dashboard state consistency', () => {
    test('/api/status column counts match UI + response has required fields @smoke', async ({ page }) => {
        await gotoPipelineWithMockedSessions(page);

        const resp = await page.request.get('/api/status');
        expect(resp.ok()).toBe(true);
        const data = await resp.json();

        for (const key of ['repos', 'generatedAt', 'summary']) expect(data).toHaveProperty(key);
        for (const key of ['implementing', 'complete', 'waiting', 'error']) expect(data.summary).toHaveProperty(key);

        for (const repo of data.repos) {
            for (const key of ['path', 'name', 'features', 'storage']) expect(repo).toHaveProperty(key);
            expect(repo.storage).toHaveProperty('backend');
            if (repo.storage.backend === 'local') {
                expect(repo.storage.health).toBe('ok');
            }
            expect(Array.isArray(repo.features)).toBe(true);
            const byStage = {};
            for (const f of repo.features) {
                for (const key of ['id', 'name', 'stage']) expect(f).toHaveProperty(key);
                // F590: done features ship a LEAN shape on the poll path — no
                // agents/validActions (those live behind /api/feature/:id/details).
                // Heavy fields are asserted only on non-done rows.
                if (f.stage !== 'done') {
                    for (const key of ['agents', 'validActions']) expect(f).toHaveProperty(key);
                    expect(Array.isArray(f.agents)).toBe(true);
                    expect(Array.isArray(f.validActions)).toBe(true);
                    for (const va of f.validActions) {
                        for (const key of ['action', 'label']) expect(typeof va[key]).toBe('string');
                    }
                }
                (byStage[f.stage] = byStage[f.stage] || []).push(f);
            }
            for (const [stage, list] of Object.entries(byStage)) {
                if (stage === 'done' || stage === 'paused' || list.length === 0) continue;
                const col = page.locator(`.kanban-col[data-stage="${stage}"]`).first();
                await expect(col).toBeVisible({ timeout: 5000 });
                await expect(col.locator('.col-count').first()).toContainText(String(list.length), { timeout: 3000 });
            }
        }
    });
});
