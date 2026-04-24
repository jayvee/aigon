// @ts-check
'use strict';

/**
 * E2E: close-failure-event — Resolve & close button and failure info.
 *
 * Seeds the 'e2e close failure feature' (pre-created in setup.js) with a
 * feature_close.failed event and verifies the dashboard renders:
 *   1. "Resolve & close" button instead of plain "Close"
 *   2. The inline failure line showing the conflict file(s)
 *
 * Run: npx playwright test --config tests/dashboard-e2e/playwright.config.js close-failure-event
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const engine = require('../../lib/workflow-core/engine');
const wf = require('../../lib/workflow-core');
const { readCtx, forceRefresh, gotoPipelineWithMockedSessions } = require('./_helpers');

const FEATURE_NAME = 'e2e close failure feature';
const FEATURE_DESC = 'e2e-close-failure-feature';

async function seedCloseFailure(repoPath) {
    // Discover the numeric ID from the workflow directory
    const workflowRoot = path.join(repoPath, '.aigon', 'workflows', 'features');
    const ids = fs.readdirSync(workflowRoot).filter(d => /^\d+$/.test(d));
    let featureId = null;
    for (const id of ids) {
        const snap = wf.getEntityWorkflowPaths(repoPath, 'feature', id);
        try {
            const events = fs.readFileSync(snap.eventsPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
            const started = events.find(e => e.type === 'feature.started' || e.type === 'feature.bootstrapped');
            if (!started) continue;
            // Check if any event references close-failure-feature
            const snapshot = JSON.parse(fs.readFileSync(snap.snapshotPath, 'utf8'));
            if (snapshot && String(snapshot.specPath || '').includes(FEATURE_DESC)) {
                featureId = id;
                break;
            }
        } catch (_) { /* skip */ }
    }
    if (!featureId) {
        // Feature is still in backlog (not started yet) — start it
        // Find by scanning spec files
        const specDirs = ['02-backlog', '03-in-progress'].map(d => path.join(repoPath, 'docs', 'specs', 'features', d));
        for (const dir of specDirs) {
            if (!fs.existsSync(dir)) continue;
            const match = fs.readdirSync(dir).find(f => f.includes(FEATURE_DESC));
            if (match) {
                const m = match.match(/^feature-(\d+)-/);
                if (m) { featureId = m[1]; break; }
            }
        }
    }
    if (!featureId) throw new Error(`Could not find feature ID for ${FEATURE_DESC} in ${repoPath}`);

    // Start if not already started
    const snap = await wf.showFeatureOrNull(repoPath, featureId);
    if (!snap || snap.currentSpecState === 'backlog') {
        await engine.startFeature(repoPath, featureId, 'solo_worktree', ['cc']);
    }

    // Signal ready if not already
    const snap2 = await wf.showFeatureOrNull(repoPath, featureId);
    const ccAgent = snap2 && snap2.agents && snap2.agents['cc'];
    if (ccAgent && ccAgent.status !== 'ready') {
        await engine.signalAgentReady(repoPath, featureId, 'cc');
    }

    // Inject the close failure event
    const { recordCloseFailure } = require('../../lib/feature-close');
    await recordCloseFailure(
        repoPath,
        featureId,
        'CONFLICT (content): Merge conflict in lib/commands/setup.js\nCONFLICT (content): Merge conflict in feature-335-foo.md\nAutomatic merge failed',
        1
    );
    return featureId;
}

test.describe('Close failure event dashboard rendering', () => {
    test('snapshot with merge-conflict lastCloseFailure shows "Resolve & close" and failure info', async ({ page }) => {
        const ctx = readCtx();
        const repoPath = ctx.tmpDir;

        await seedCloseFailure(repoPath);

        await gotoPipelineWithMockedSessions(page);
        await forceRefresh(page);

        // Find the card in in-progress
        const inProgressCol = page.locator('.kanban-col[data-stage="in-progress"]');
        const card = inProgressCol.locator('.kcard').filter({ hasText: FEATURE_NAME }).first();
        await expect(card).toBeVisible({ timeout: 8000 });

        // Should have "Resolve & close" button, not plain "Close"
        const resolveBtn = card.locator('.kcard-va-btn[data-va-action="feature-resolve-and-close"]');
        await expect(resolveBtn).toBeVisible({ timeout: 5000 });
        await expect(resolveBtn).toContainText('Resolve & close');

        // Should NOT have a plain "feature-close" action button
        const closeBtn = card.locator('.kcard-va-btn[data-va-action="feature-close"]');
        await expect(closeBtn).toHaveCount(0);

        // Should render inline failure info with the conflict file
        const failureInfo = card.locator('.kcard-close-failure');
        await expect(failureInfo).toBeVisible({ timeout: 3000 });
        await expect(failureInfo).toContainText('lib/commands/setup.js');
    });
});
