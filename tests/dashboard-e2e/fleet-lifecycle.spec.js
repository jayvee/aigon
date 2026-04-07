// @ts-check
'use strict';

/**
 * E2E: Fleet mode lifecycle via dashboard.
 *
 * inbox → Prioritise → backlog → Start (cc + gg) → in-progress → two MockAgents
 *  with staggered delays → cc submitted while gg still working → both submitted
 *  → eval → in-evaluation → write winner → close cc → done.
 *
 * GEMINI_CLI=1 in setup.js makes feature-eval run in eval-setup mode (no agent
 * launch), so the eval step here only verifies UI plumbing.
 *
 * Run: npx playwright test --config tests/dashboard-e2e/playwright.config.js fleet-lifecycle
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { MockAgent } = require('../integration/mock-agent');
const {
    readCtx,
    waitForPath,
    forceRefresh,
    gotoPipelineWithMockedSessions,
    prioritiseInboxFeature,
    startFeatureWithAgents,
    expectFeatureClosed,
    expectConsoleHasAction,
} = require('./_helpers');

// Fleet asserts an intermediate state (cc submitted, gg still in flight) AND a
// final all-submitted state. Both observations need the dashboard poll cycle to
// catch transitions reliably. Fast delays race those cycles and produce flakes,
// so this test uses realistic delays unconditionally — ~40s total runtime.
const CC_DELAYS = { implementing: 3000, submitted: 1500 };
const GG_DELAYS = { implementing: 8000, submitted: 1500 };

function runGit(args, cwd) {
    spawnSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
}

test.describe('Fleet mode lifecycle', () => {
    test('full fleet lifecycle: inbox → setup cc+gg → submit both → eval → close cc → done', async ({ page }) => {
        const ctx = readCtx();
        const featureName = 'e2e fleet feature';
        const desc = 'e2e-fleet-feature';

        await gotoPipelineWithMockedSessions(page);

        // Inbox → Backlog
        const paddedId = await prioritiseInboxFeature(page, featureName);

        // Backlog → In-progress with cc + gg
        await startFeatureWithAgents(page, featureName, ['cc', 'gg']);

        const inProgressCol = page.locator('.kanban-col[data-stage="in-progress"]').first();
        await expect(inProgressCol).toContainText(featureName, { timeout: 8000 });
        const inProgressCard = inProgressCol.locator('.kcard').filter({ hasText: featureName }).first();
        await expect(inProgressCard.locator('.kcard-agent')).toHaveCount(2, { timeout: 5000 });

        // ── Step 5: Run two MockAgents with staggered delays ──────────────────

        const ccWorktreePath = path.join(ctx.worktreeBase, `feature-${paddedId}-cc-${desc}`);
        const ggWorktreePath = path.join(ctx.worktreeBase, `feature-${paddedId}-gg-${desc}`);
        // Wait for the log files specifically — the worktree dir is created
        // early but the log file is written later (after install-agent).
        const ccLogPath = path.join(ccWorktreePath, 'docs', 'specs', 'features', 'logs', `feature-${paddedId}-cc-${desc}-log.md`);
        const ggLogPath = path.join(ggWorktreePath, 'docs', 'specs', 'features', 'logs', `feature-${paddedId}-gg-${desc}-log.md`);

        await Promise.all([
            waitForPath(ccLogPath, 30000),
            waitForPath(ggLogPath, 30000),
        ]);

        const agentCC = new MockAgent({ featureId: paddedId, agentId: 'cc', desc, repoPath: ctx.tmpDir, worktreeBase: ctx.worktreeBase, delays: CC_DELAYS });
        const agentGG = new MockAgent({ featureId: paddedId, agentId: 'gg', desc, repoPath: ctx.tmpDir, worktreeBase: ctx.worktreeBase, delays: GG_DELAYS });

        // Start both — cc finishes first
        const ccRunning = agentCC.run();
        const ggRunning = agentGG.run();

        await ccRunning;

        // Intermediate state: cc submitted, gg still implementing
        await forceRefresh(page);
        await page.waitForTimeout(500);

        const ccSubmitted = inProgressCard.locator('.kcard-agent.agent-cc .kcard-agent-status.status-submitted');
        await expect(ccSubmitted).toBeVisible({ timeout: 5000 });

        // REGRESSION: this used to assert `.status-running` on gg, but since
        // commit cd784ebb (2026-04-01) the dashboard only renders that class
        // when `tmuxRunning === true`. The e2e suite mocks /api/session/** and
        // never creates a real tmux session, so the running class never
        // appears under test. The intent of this checkpoint is "gg has NOT
        // yet crossed over to submitted while cc has" — assert that directly,
        // independent of which CSS class the dashboard happens to render for
        // an in-flight agent without a live tmux session.
        const ggSubmittedYet = inProgressCard.locator('.kcard-agent.agent-gg .kcard-agent-status.status-submitted');
        await expect(ggSubmittedYet).toHaveCount(0);

        await ggRunning;

        // ── Step 6: Both submitted — verify all-submitted state ───────────────

        // Give the async engine signal from MockAgent's CLI call time to
        // flush through the event log before the dashboard re-reads.
        await page.waitForTimeout(1000);
        await forceRefresh(page);
        await page.waitForTimeout(500);
        await forceRefresh(page);
        await page.waitForTimeout(500);

        const allSubmittedStatuses = inProgressCard.locator('.kcard-agent .kcard-agent-status.status-submitted');
        await expect(allSubmittedStatuses).toHaveCount(2, { timeout: 10000 });

        // Fleet mode: feature-eval button should appear (not feature-close)
        const evalBtn = inProgressCard.locator('.kcard-va-btn[data-va-action="feature-eval"]');
        await expect(evalBtn).toBeVisible({ timeout: 5000 });
        const soloCloseBtn = inProgressCard.locator('.kcard-va-btn[data-va-action="feature-close"]');
        await expect(soloCloseBtn).toHaveCount(0);

        // ── Step 7: Run eval via dashboard action ─────────────────────────────

        // Clicking "Evaluate" opens the agent-picker modal — pick cc, then submit.
        await evalBtn.click();
        const evalPicker = page.locator('#agent-picker');
        await expect(evalPicker).toBeVisible({ timeout: 5000 });
        const evalCcRadio = evalPicker.locator('input[value="cc"]').first();
        await expect(evalCcRadio).toBeVisible();
        await evalCcRadio.check();

        const [evalResp] = await Promise.all([
            page.waitForResponse('**/api/action'),
            page.click('#agent-picker-submit'),
        ]);
        const evalJson = await evalResp.json().catch(() => ({}));
        expect(evalJson.ok, `feature-eval failed: ${evalJson.error || evalJson.stderr || ''}`).toBe(true);

        await page.waitForResponse('**/api/refresh');

        const inEvalCol = page.locator('.kanban-col[data-stage="in-evaluation"]').first();
        await expect(inEvalCol).toContainText(featureName, { timeout: 8000 });

        // ── Step 8: Simulate eval result — write winner to eval file ──────────

        const evalDir = path.join(ctx.tmpDir, 'docs', 'specs', 'features', 'evaluations');
        const evalFile = path.join(evalDir, `feature-${paddedId}-eval.md`);
        await waitForPath(evalFile, 5000);

        const existingEval = fs.readFileSync(evalFile, 'utf8');
        fs.writeFileSync(evalFile, existingEval + '\n**Winner: cc**\n');

        // Bring gg's log into the main repo (flat logs/ directory)
        const mainLogsDir = path.join(ctx.tmpDir, 'docs', 'specs', 'features', 'logs');
        const ggLogSrc = path.join(ggWorktreePath, 'docs', 'specs', 'features', 'logs', `feature-${paddedId}-gg-${desc}-log.md`);
        const ggLogDest = path.join(mainLogsDir, `feature-${paddedId}-gg-${desc}-log.md`);
        fs.mkdirSync(mainLogsDir, { recursive: true });
        fs.copyFileSync(ggLogSrc, ggLogDest);

        runGit(['add', 'docs/specs/features/'], ctx.tmpDir);
        runGit(['commit', '-m', `chore: write eval results for feature ${paddedId}`], ctx.tmpDir);

        // ── Step 9: Close with winner (cc) via dashboard ──────────────────────

        await forceRefresh(page);
        await page.waitForTimeout(500);

        const inEvalCard = inEvalCol.locator('.kcard').filter({ hasText: featureName }).first();
        await expect(inEvalCard).toBeVisible({ timeout: 5000 });

        const fleetCloseBtn = inEvalCard.locator('.kcard-va-btn[data-va-action="feature-close"]');
        await expect(fleetCloseBtn).toBeVisible({ timeout: 5000 });
        await fleetCloseBtn.click();

        // Fleet close opens the "Close & Merge" modal — select winner
        const closeModal = page.locator('#close-modal');
        await expect(closeModal).toBeVisible({ timeout: 5000 });
        const ccWinnerRadio = closeModal.locator('#close-modal-winners input[value="cc"]');
        await expect(ccWinnerRadio).toBeVisible();
        await ccWinnerRadio.check();

        const [closeResp] = await Promise.all([
            page.waitForResponse('**/api/action'),
            page.click('#close-modal-submit'),
        ]);
        const closeJson = await closeResp.json().catch(() => ({}));
        expect(closeJson.ok, `feature-close failed: ${closeJson.error || closeJson.stderr || ''}`).toBe(true);

        await page.waitForResponse('**/api/refresh');
        await page.waitForTimeout(500);

        await expectFeatureClosed(page, featureName, ['in-evaluation']);
        await expectConsoleHasAction(page, 'feature-close');
    });
});
