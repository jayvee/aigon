// @ts-check
'use strict';
/**
 * E2E: Dashboard "Mark X complete" escape hatch (F405).
 *
 * Verifies that:
 *  1. The overflow ⋯ menu shows "Mark implementation complete" when an agent
 *     has a status file with taskType:'do' but no completion signal.
 *  2. The menu item is absent once the completion signal is present.
 *  3. Clicking the item advances the workflow state (agent shows submitted).
 *
 * Run: npx playwright test --config tests/dashboard-e2e/playwright.config.js mark-complete
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
    GIT_SAFE_ENV, readCtx, forceRefresh,
    gotoPipelineWithMockedSessions, startFeatureWithAgents,
} = require('./_helpers');
const CLI_PATH = path.join(__dirname, '..', '..', 'aigon-cli.js');

const FEATURE_NAME = 'e2e mark complete feature';

function runCli(args, cwd, extraEnv = {}) {
    const r = spawnSync(process.execPath, [CLI_PATH, ...args], {
        cwd, encoding: 'utf8', stdio: 'pipe',
        env: { ...process.env, ...GIT_SAFE_ENV, ...extraEnv },
    });
    if (r.status !== 0) throw new Error(`aigon ${args.join(' ')} failed (${r.status}): ${r.stderr || r.stdout}`);
    return r;
}

function writeStatusFile(repoPath, featureId, agentId, data) {
    const stateDir = path.join(repoPath, '.aigon', 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    const filePath = path.join(stateDir, `feature-${featureId}-${agentId}.json`);
    const existing = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : {};
    fs.writeFileSync(filePath, JSON.stringify({ ...existing, ...data, agent: agentId, updatedAt: new Date().toISOString() }, null, 2));
}

test('mark-complete: renders menu item when signal missing; absent when present; advances state on click', async ({ page }) => {
    const ctx = readCtx();
    await gotoPipelineWithMockedSessions(page);

    // Feature is already in backlog from global setup
    const backlogCol = page.locator('.kanban-col[data-stage="backlog"]').first();
    await expect(backlogCol).toContainText(FEATURE_NAME, { timeout: 8000 });
    const backlogCard = backlogCol.locator('.kcard').filter({ hasText: FEATURE_NAME }).first();
    const idText = (await backlogCard.locator('.kcard-id, [data-feature-id]').first().textContent({ timeout: 2000 }).catch(() => '')) || '';
    const m = idText.match(/(\d+)/);
    expect(m && m[1], 'could not read featureId from backlog card').toBeTruthy();
    const paddedId = String(m[1]).padStart(2, '0');

    // Start with cc agent via agent picker (creates engine snapshot + worktree)
    await startFeatureWithAgents(page, FEATURE_NAME, ['cc']);
    const inProgressCol = page.locator('.kanban-col[data-stage="in-progress"]').first();
    await expect(inProgressCol).toContainText(FEATURE_NAME, { timeout: 8000 });
    const ipCard = inProgressCol.locator('.kcard').filter({ hasText: FEATURE_NAME }).first();
    await expect(ipCard.locator('.kcard-agent.agent-cc')).toBeVisible({ timeout: 5000 });

    // ── Test 1: menu item ABSENT when no status file (no session) ─────────────
    // (status file doesn't exist yet — pendingCompletionSignal is null)
    await forceRefresh(page);
    const overflowToggle = ipCard.locator('.kcard-agent.agent-cc .kcard-overflow-toggle');
    if (await overflowToggle.isVisible({ timeout: 1000 }).catch(() => false)) {
        await overflowToggle.click();
        await expect(ipCard.locator('.kcard-mark-complete-btn')).toHaveCount(0);
        await overflowToggle.click(); // close
    }

    // ── Test 2: menu item PRESENT when taskType='do', status='implementing' ───
    writeStatusFile(ctx.tmpDir, paddedId, 'cc', { status: 'implementing', taskType: 'do', flags: {} });
    await forceRefresh(page);
    await expect(overflowToggle).toBeVisible({ timeout: 5000 });
    await overflowToggle.click();
    const markBtn = ipCard.locator('.kcard-mark-complete-btn');
    await expect(markBtn).toBeVisible({ timeout: 3000 });
    await expect(markBtn).toContainText('Mark implementation complete');
    await overflowToggle.click(); // close menu

    // ── Test 3: menu item ABSENT when completion signal already present ────────
    writeStatusFile(ctx.tmpDir, paddedId, 'cc', { status: 'implementation-complete', taskType: null, flags: {} });
    await forceRefresh(page);
    if (await overflowToggle.isVisible({ timeout: 1000 }).catch(() => false)) {
        await overflowToggle.click();
        await expect(ipCard.locator('.kcard-mark-complete-btn')).toHaveCount(0);
        await overflowToggle.click();
    }

    // ── Test 4: clicking the button advances the workflow state ───────────────
    writeStatusFile(ctx.tmpDir, paddedId, 'cc', { status: 'implementing', taskType: 'do', flags: {} });
    await forceRefresh(page);
    await overflowToggle.click();
    const [markResp] = await Promise.all([
        page.waitForResponse(resp => resp.url().includes('/mark-complete')),
        markBtn.click(),
    ]);
    expect(markResp.status(), 'mark-complete should return 200').toBe(200);
    // Dashboard auto-refreshes after postMarkComplete; agent should show submitted
    await expect(ipCard.locator('.kcard-agent.agent-cc .kcard-agent-status.status-submitted'))
        .toBeVisible({ timeout: 8000 });
});
