// @ts-check
'use strict';
/**
 * E2E: Dashboard failure modes — crash mid-work, never-signals, error signal.
 *
 * Uses MockAgent's tmux mode with the official session name so the dashboard
 * supervisor sees the session. Each sub-test drives a different mock profile.
 *
 * REGRESSION: crash mid-work — verifies that killing a tmux session triggers
 * the shell trap (agent-status error) and the dashboard renders recovery
 * actions (restart-agent, force-agent-ready).
 *
 * REGRESSION: never signals — verifies that an agent without progress events
 * gets a workflow-idle badge in the monitor view after the supervisor sweep.
 *
 * REGRESSION: error signal — verifies that an explicit agent-status error sets
 * the agent to failed and the dashboard offers recovery validActions.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { MockAgent } = require('../integration/mock-agent');
const {
    GIT_SAFE_ENV, readCtx, waitForPath, forceRefresh,
    gotoPipelineWithMockedSessions, startFeatureWithAgents,
} = require('./_helpers');

const FAST = process.env.MOCK_DELAY === 'fast' || !!process.env.CI;

/**
 * Poll the dashboard agent row until the given status appears (or a timeout).
 */
async function waitForAgentStatus(page, card, agentClass, targetStatus, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        await forceRefresh(page);
        const section = card.locator(`.kcard-agent.${agentClass}`);
        const text = await section.textContent().catch(() => '');
        if (text.toLowerCase().includes(targetStatus.toLowerCase())) return;
        await page.waitForTimeout(400);
    }
    throw new Error(`Timed out waiting for agent status "${targetStatus}"`);
}

test.describe('Dashboard failure modes', () => {
    test('crash mid-work: tmux kill-session → failed state + recovery actions', async ({ page }) => {
        // REGRESSION: external tmux kill should trigger the EXIT trap and
        // surface agent-status error so the dashboard shows recovery options.
        const ctx = readCtx();
        await gotoPipelineWithMockedSessions(page);
        await startFeatureWithAgents(page, 'e2e solo feature', ['cc']);

        const inProgressCol = page.locator('.kanban-col[data-stage="in-progress"]').first();
        await expect(inProgressCol).toContainText('e2e solo feature', { timeout: 8000 });
        const card = inProgressCol.locator('.kcard').filter({ hasText: 'e2e solo feature' }).first();

        // Worktree was created by feature-start; attach MockAgent to the
        // official tmux session with a long sleep so we can kill it mid-work.
        const agent = new MockAgent({
            featureId: '09', agentId: 'cc', desc: 'e2e-solo-feature',
            repoPath: ctx.tmpDir, worktreeBase: ctx.worktreeBase,
            delays: { implementing: 60000, submitted: 10000 },
            useRealWrapper: true, useOfficialSessionName: true, profile: 'happy',
        });
        const runPromise = agent.run();

        // Confirm agent is running before the kill
        await waitForAgentStatus(page, card, 'agent-cc', 'Running', FAST ? 6000 : 10000);

        // Kill the tmux session (simulates machine crash / OOM kill)
        await page.waitForTimeout(FAST ? 800 : 1500);
        spawnSync('tmux', ['kill-session', '-t', agent.sessionName], { stdio: 'ignore' });

        // Wait for the trap-driven agent-status error to propagate
        await waitForAgentStatus(page, card, 'agent-cc', 'failed', FAST ? 8000 : 15000);

        // Assert recovery validActions are present
        await expect(card.locator('.kcard-va-btn[data-va-action="restart-agent"]')).toBeVisible({ timeout: 5000 });
        await expect(card.locator('.kcard-va-btn[data-va-action="force-agent-ready"]')).toBeVisible({ timeout: 5000 });
        // drop-agent is NOT available for solo features (only one agent)
        await expect(card.locator('.kcard-va-btn[data-va-action="drop-agent"]')).toHaveCount(0);
    });

    test('never signals: no progress → workflow idle badge in monitor', async ({ page }) => {
        // REGRESSION: agent that never calls agent-status should show an idle
        // badge after the supervisor detects workflow staleness.
        const ctx = readCtx();
        await gotoPipelineWithMockedSessions(page);
        await startFeatureWithAgents(page, 'e2e drive feature', ['cc']);

        const inProgressCol = page.locator('.kanban-col[data-stage="in-progress"]').first();
        await expect(inProgressCol).toContainText('e2e drive feature', { timeout: 8000 });
        const card = inProgressCol.locator('.kcard').filter({ hasText: 'e2e drive feature' }).first();

        // Attach MockAgent in never-submit profile (sleeps long, no agent-status)
        const agent = new MockAgent({
            featureId: '11', agentId: 'cc', desc: 'e2e-drive-feature',
            repoPath: ctx.tmpDir, worktreeBase: ctx.worktreeBase,
            delays: { implementing: 60000, submitted: 10000 },
            useRealWrapper: true, useOfficialSessionName: true, profile: 'never-submit',
        });
        await agent.run();

        // Confirm agent is running
        await waitForAgentStatus(page, card, 'agent-cc', 'Running', FAST ? 6000 : 10000);

        // Lower idle thresholds so the badge appears on the next supervisor sweep
        const globalConfigPath = path.join(ctx.tempHome, '.aigon', 'config.json');
        const globalConfig = JSON.parse(fs.readFileSync(globalConfigPath, 'utf8'));
        globalConfig.supervisor = {
            idleThresholdsMinutes: { soft: 0, notify: 0, sticky: 0 },
        };
        fs.writeFileSync(globalConfigPath, JSON.stringify(globalConfig, null, 2));

        // Wait long enough for the supervisor sweep (2s interval) + poll cycle
        await page.waitForTimeout(FAST ? 3500 : 5000);
        await forceRefresh(page);

        // Switch to monitor view and look for the workflow-idle badge
        await page.click('#tab-monitor');
        await page.waitForSelector('#monitor-view', { timeout: 5000 });
        const monitorItem = page.locator('#monitor-view .monitor-item').filter({ hasText: 'e2e drive feature' }).first();
        await expect(monitorItem).toBeVisible({ timeout: 5000 });
        const idleBadge = monitorItem.locator('.workflow-idle-badge');
        await expect(idleBadge).toBeVisible({ timeout: 8000 });
    });

    test('error signal: mock bin exits with error → failed state + recovery actions', async ({ page }) => {
        // REGRESSION: explicit agent-status error (via trap on non-zero exit)
        // should set the agent to failed and surface recovery validActions.
        const ctx = readCtx();
        await gotoPipelineWithMockedSessions(page);
        await startFeatureWithAgents(page, 'e2e fleet feature', ['cc']);

        const inProgressCol = page.locator('.kanban-col[data-stage="in-progress"]').first();
        await expect(inProgressCol).toContainText('e2e fleet feature', { timeout: 8000 });
        const card = inProgressCol.locator('.kcard').filter({ hasText: 'e2e fleet feature' }).first();

        // Attach MockAgent in error-mid profile (sleeps briefly then exits 1)
        const agent = new MockAgent({
            featureId: '10', agentId: 'cc', desc: 'e2e-fleet-feature',
            repoPath: ctx.tmpDir, worktreeBase: ctx.worktreeBase,
            delays: { implementing: FAST ? 600 : 3000, submitted: 10000 },
            useRealWrapper: true, useOfficialSessionName: true, profile: 'error-mid',
        });
        await agent.run();

        // Wait for the mock bin to sleep then exit, triggering the trap
        await waitForAgentStatus(page, card, 'agent-cc', 'failed', FAST ? 8000 : 15000);

        // Assert recovery validActions are present
        await expect(card.locator('.kcard-va-btn[data-va-action="restart-agent"]')).toBeVisible({ timeout: 5000 });
        await expect(card.locator('.kcard-va-btn[data-va-action="force-agent-ready"]')).toBeVisible({ timeout: 5000 });
    });
});
