// @ts-check
'use strict';
/**
 * Opt-in live-agent smoke (F594) — NOT part of `npm run test:browser` / CI.
 *
 * Verifies the dashboard → feature-start → real cc tmux path still works against
 * a live Claude Code session. Pinned to Haiku via setup-live.js env.
 *
 * Run: AIGON_E2E_REAL=1 npm run test:browser:live
 */
const { test, expect } = require('@playwright/test');
const { LIVE_AGENT_GATE } = require('./e2e-env');
const {
    readCtx,
    gotoPipelineWithMockedSessions,
    createInboxFeatureViaUI,
    prioritiseFromInboxViaUI,
    startFeatureWithAgents,
    tmuxSessionFor,
    expectTmuxPaneContains,
} = require('./_helpers');

test.describe('Live-agent smoke @live-agent', () => {
    test.skip(process.env[LIVE_AGENT_GATE] !== '1', 'requires AIGON_E2E_REAL=1');

    test('create → prioritise → start cc → real claude banner in tmux pane', async ({ page }) => {
        const title = 'live smoke feature';
        await gotoPipelineWithMockedSessions(page);
        await createInboxFeatureViaUI(page, title);
        const paddedId = await prioritiseFromInboxViaUI(page, title);
        const ctx = readCtx();
        expect(ctx.live, 'fixture must be bootstrapped in live-agent mode').toBe(true);

        await startFeatureWithAgents(page, title, ['cc']);
        const session = tmuxSessionFor(paddedId, 'cc', ctx.tmpDir, 'do');
        await expectTmuxPaneContains(session, /claude|Claude Code|anthropic/i, 30000);
    });
});
