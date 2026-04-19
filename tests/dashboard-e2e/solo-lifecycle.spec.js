// @ts-check
'use strict';

/**
 * E2E: Solo lifecycle via dashboard, parametrized over worktree + branch modes.
 *
 * worktree: inbox → Prioritise → Start (cc) → in-progress → MockAgent submits →
 *           Close → done.
 * branch:   inbox → Prioritise → CLI feature-start (no agent) → in-progress →
 *           inline solo mock → Close → done. The dashboard picker requires ≥1
 *           agent, so branch mode enters via the CLI.
 *
 * REGRESSION: branch mode prevents feature 233's bug — solo-branch close used
 * to throw "cannot be closed from implementing" because feature.started was
 * emitted with agents:[]. The bug shipped because no e2e covered solo-branch
 * close from the dashboard; this spec keeps that coverage in one place.
 *
 * Run: npx playwright test --config tests/dashboard-e2e/playwright.config.js solo-lifecycle
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { MockAgent } = require('../integration/mock-agent');
const {
    SOLO_DELAYS, GIT_SAFE_ENV, readCtx, waitForPath, forceRefresh,
    gotoPipelineWithMockedSessions, prioritiseInboxFeature, startFeatureWithAgents,
    clickCardAction, expectFeatureClosed, expectConsoleHasAction,
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

const SCENARIOS = [
    {
        mode: 'worktree',
        featureName: 'e2e solo feature',
        desc: 'e2e-solo-feature',
        agentBadge: 'cc',
    },
    {
        mode: 'branch',
        featureName: 'e2e drive feature',
        desc: 'e2e-drive-feature',
        agentBadge: 'solo',
    },
];

for (const s of SCENARIOS) {
    test.describe(`Solo ${s.mode} lifecycle`, () => {
        test(`full solo-${s.mode} lifecycle: inbox → start → submit → close → done`, async ({ page }) => {
            const ctx = readCtx();
            await gotoPipelineWithMockedSessions(page);
            const paddedId = await prioritiseInboxFeature(page, s.featureName);

            if (s.mode === 'worktree') {
                await startFeatureWithAgents(page, s.featureName, ['cc']);
            } else {
                // No agent via CLI = solo-branch (feature 233 regression path).
                runCli(['feature-start', paddedId], ctx.tmpDir);
                await forceRefresh(page);
                await page.waitForTimeout(500);
            }

            const inProgressCol = page.locator('.kanban-col[data-stage="in-progress"]').first();
            await expect(inProgressCol).toContainText(s.featureName, { timeout: 8000 });
            const inProgressCard = inProgressCol.locator('.kcard').filter({ hasText: s.featureName }).first();
            const agentSection = inProgressCard.locator(`.kcard-agent.agent-${s.agentBadge}`);
            await expect(agentSection).toBeVisible({ timeout: 5000 });
            if (s.mode === 'branch') await expect(agentSection).toContainText('Drive');

            if (s.mode === 'worktree') {
                const worktreePath = path.join(ctx.worktreeBase, `feature-${paddedId}-cc-${s.desc}`);
                await waitForPath(worktreePath, 15000);
                await new MockAgent({
                    featureId: paddedId, agentId: 'cc', desc: s.desc,
                    repoPath: ctx.tmpDir, worktreeBase: ctx.worktreeBase, delays: SOLO_DELAYS,
                }).run();
            } else {
                await runSoloBranchMock({ repoPath: ctx.tmpDir, featureId: paddedId, delays: SOLO_DELAYS });
            }

            await forceRefresh(page);
            await page.waitForTimeout(500);

            const submittedBadge = inProgressCard.locator(`.kcard-agent.agent-${s.agentBadge} .kcard-agent-status.status-submitted`);
            await expect(submittedBadge).toBeVisible({ timeout: 8000 });

            // Solo mode (both variants): no eval action, only close.
            await expect(inProgressCard.locator('.kcard-va-btn[data-va-action="feature-eval"]')).toHaveCount(0);

            await clickCardAction(page, inProgressCard, 'feature-close', 'feature-close');
            await expectFeatureClosed(page, s.featureName);
            if (s.mode === 'worktree') await expectConsoleHasAction(page, 'feature-close');
        });
    });
}
