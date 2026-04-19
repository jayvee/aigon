// @ts-check
'use strict';

/**
 * E2E: Solo-branch (Drive without worktree) lifecycle via dashboard.
 *
 * Solo-branch mode = `aigon feature-start <id>` with no agent: a branch in the
 * main repo, no worktree. The dashboard agent picker requires ≥1 agent so this
 * mode can't be started from the UI — the test invokes the CLI directly, then
 * verifies the dashboard correctly displays the "Drive" agent section, accepts
 * a `submitted` signal, and closes via the dashboard Close button.
 *
 * REGRESSION: prevents feature 233's bug from re-emerging silently. That bug
 * shipped because no e2e covered solo-branch close from the dashboard, so the
 * "feature.started with agents:[]" projector hole stayed hidden until the user
 * hit it manually in farline-ai-forge.
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
    SOLO_DELAYS, GIT_SAFE_ENV, readCtx, forceRefresh, gotoPipelineWithMockedSessions,
    prioritiseInboxFeature, clickCardAction, expectFeatureClosed,
} = require('./_helpers');

const CLI_PATH = path.join(__dirname, '..', '..', 'aigon-cli.js');

function runCli(args, cwd, extraEnv = {}) {
    const r = spawnSync(process.execPath, [CLI_PATH, ...args], {
        cwd, encoding: 'utf8', stdio: 'pipe',
        env: { ...process.env, ...GIT_SAFE_ENV, ...extraEnv },
    });
    if (r.status !== 0) throw new Error(`aigon ${args.join(' ')} failed (${r.status}): ${r.stderr || r.stdout}`);
    return r;
}

/** Solo-branch mock: implement file → commit → agent-status submitted. */
async function runSoloBranchMock({ repoPath, featureId, delays }) {
    await new Promise(r => setTimeout(r, delays.implementing));
    fs.writeFileSync(path.join(repoPath, `mock-solo-f${featureId}.js`), `// mock f${featureId}\n`);
    spawnSync('git', ['add', '.'], { cwd: repoPath, env: { ...process.env, ...GIT_SAFE_ENV } });
    spawnSync('git', ['commit', '-m', `feat: mock solo-branch ${featureId}`], {
        cwd: repoPath, env: { ...process.env, ...GIT_SAFE_ENV },
    });
    await new Promise(r => setTimeout(r, delays.submitted));
    runCli(['agent-status', 'submitted'], repoPath, {
        AIGON_TEST_MODE: '1', AIGON_ENTITY_TYPE: 'feature', AIGON_ENTITY_ID: featureId,
        AIGON_AGENT_ID: 'solo', AIGON_PROJECT_PATH: repoPath, AIGON_FORCE_PRO: 'true',
    });
}

test.describe('Solo-branch lifecycle', () => {
    test('full solo-branch lifecycle: inbox → prioritise → CLI feature-start (no agent) → submit → close → done', async ({ page }) => {
        const ctx = readCtx();
        const featureName = 'e2e drive feature';

        await gotoPipelineWithMockedSessions(page);

        const paddedId = await prioritiseInboxFeature(page, featureName);

        // Backlog → In-progress via CLI (no agent = solo-branch). The dashboard
        // agent picker requires ≥1 agent so this can't go through the UI; the
        // CLI is the canonical entry point for this mode.
        runCli(['feature-start', paddedId], ctx.tmpDir);

        await forceRefresh(page);
        await page.waitForTimeout(500);

        const inProgressCol = page.locator('.kanban-col[data-stage="in-progress"]').first();
        await expect(inProgressCol).toContainText(featureName, { timeout: 8000 });
        const inProgressCard = inProgressCol.locator('.kcard').filter({ hasText: featureName }).first();
        const driveSection = inProgressCard.locator('.kcard-agent.agent-solo');
        await expect(driveSection).toBeVisible({ timeout: 5000 });
        await expect(driveSection).toContainText('Drive');

        await runSoloBranchMock({ repoPath: ctx.tmpDir, featureId: paddedId, delays: SOLO_DELAYS });

        await forceRefresh(page);
        await page.waitForTimeout(500);

        const submittedBadge = inProgressCard.locator('.kcard-agent.agent-solo .kcard-agent-status.status-submitted');
        await expect(submittedBadge).toBeVisible({ timeout: 8000 });

        // Solo-branch exposes Close, not Eval (eval is fleet-only).
        await expect(inProgressCard.locator('.kcard-va-btn[data-va-action="feature-eval"]')).toHaveCount(0);

        // Close → done. This is feature 233's regression path — solo-branch
        // close used to throw "cannot be closed from implementing" because
        // feature.started was emitted with agents:[].
        await clickCardAction(page, inProgressCard, 'feature-close', 'feature-close');
        await expectFeatureClosed(page, featureName);
    });
});
