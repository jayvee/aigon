// @ts-check
'use strict';

/**
 * E2E: Solo worktree lifecycle via dashboard.
 *
 * Exercises the full solo worktree happy path driven through the dashboard UI:
 *   inbox → Prioritise → backlog → Start feature (cc) → in-progress →
 *   MockAgent submits → dashboard refresh → Accept & Close → done
 *
 * Uses a real dashboard server (started by globalSetup) pointed at a temp
 * fixture repo. MockAgent runs as a Node process from within the test.
 *
 * Run: npx playwright test --config tests/dashboard-e2e/playwright.config.js solo-lifecycle
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { MockAgent } = require('../integration/mock-agent');

const CTX_FILE = path.join(os.tmpdir(), 'aigon-dashboard-e2e-ctx.json');

// Use fast mock delays in CI or when MOCK_DELAY=fast is set
const FAST = process.env.MOCK_DELAY === 'fast' || !!process.env.CI;
const MOCK_DELAYS = FAST
    ? { implementing: 600, submitted: 300 }
    : { implementing: 15000, submitted: 5000 };

function readCtx() {
    return JSON.parse(fs.readFileSync(CTX_FILE, 'utf8'));
}

/** Wait for a filesystem path to appear (polling). */
function waitForPath(p, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
        const deadline = Date.now() + timeoutMs;
        function check() {
            if (fs.existsSync(p)) return resolve();
            if (Date.now() > deadline) return reject(new Error(`Path not found within ${timeoutMs}ms: ${p}`));
            setTimeout(check, 200);
        }
        check();
    });
}

/** Force a dashboard refresh and wait for the response. */
async function forceRefresh(page) {
    const [res] = await Promise.all([
        page.waitForResponse('**/api/refresh'),
        page.evaluate(() => fetch('/api/refresh', { method: 'POST', cache: 'no-store' })),
    ]);
    return res;
}

test.describe('Solo worktree lifecycle', () => {
    test('full solo lifecycle: inbox → prioritise → setup cc → submit → close → done', async ({ page }) => {
        const ctx = readCtx();

        // Mock /api/session/** so the dashboard doesn't try to open real tmux terminals
        await page.route('**/api/session/**', route => route.fulfill({ json: { ok: true, pid: 0 } }));

        // ── Step 1: Navigate to Pipeline tab ──────────────────────────────────

        await page.goto('/');
        await page.click('#tab-pipeline');
        await page.waitForSelector('.kanban', { timeout: 10000 });

        // ── Step 2: Verify feature appears in Inbox ────────────────────────────

        const inboxCol = page.locator('.kanban-col[data-stage="inbox"]').first();
        await expect(inboxCol).toContainText('e2e solo feature', { timeout: 8000 });

        // ── Step 3: Prioritise → Backlog ───────────────────────────────────────

        const inboxCard = page.locator('.kcard').filter({ hasText: 'e2e solo feature' }).first();
        const prioritiseBtn = inboxCard.locator('.kcard-va-btn[data-va-action="feature-prioritise"]');
        await expect(prioritiseBtn).toBeVisible({ timeout: 5000 });

        // Capture action response to extract assigned feature ID
        const [actionResp] = await Promise.all([
            page.waitForResponse('**/api/action'),
            prioritiseBtn.click(),
        ]);
        const actionJson = await actionResp.json().catch(() => ({}));
        const idMatch = (actionJson.stdout || '').match(/Assigned ID:\s*(\d+)/);
        const featureId = idMatch ? idMatch[1] : null;
        const paddedId = featureId ? String(featureId).padStart(2, '0') : null;
        expect(featureId, 'feature-prioritise should assign an ID').toBeTruthy();

        // Wait for dashboard to refresh after action
        await page.waitForResponse('**/api/refresh');

        // Feature should now be in backlog
        const backlogCol = page.locator('.kanban-col[data-stage="backlog"]').first();
        await expect(backlogCol).toContainText('e2e solo feature', { timeout: 8000 });

        // ── Step 4: Start feature → agent picker → select cc → Setup ──────────

        const backlogCard = page.locator('.kcard').filter({ hasText: 'e2e solo feature' }).first();
        const setupBtn = backlogCard.locator('.kcard-va-btn[data-va-action="feature-start"]');
        await expect(setupBtn).toBeVisible({ timeout: 5000 });
        await expect(setupBtn).toContainText('Start feature');

        await setupBtn.click();

        // Agent picker modal should open
        const agentPicker = page.locator('#agent-picker');
        await expect(agentPicker).toBeVisible({ timeout: 5000 });

        // Check the cc checkbox
        const ccCheckbox = agentPicker.locator('input[value="cc"]');
        await expect(ccCheckbox).toBeVisible();
        await ccCheckbox.check();
        await expect(ccCheckbox).toBeChecked();

        // Submit — this runs `aigon feature-start <id> cc` against the fixture repo
        const [setupResp] = await Promise.all([
            page.waitForResponse('**/api/action'),
            page.click('#agent-picker-submit'),
        ]);
        const setupJson = await setupResp.json().catch(() => ({}));
        expect(setupJson.ok, `feature-start failed: ${setupJson.error || setupJson.stderr || ''}`).toBe(true);

        // Wait for UI refresh after setup
        await page.waitForResponse('**/api/refresh');

        // ── Step 5: Feature moves to In-Progress with cc implementing ──────────

        const inProgressCol = page.locator('.kanban-col[data-stage="in-progress"]').first();
        await expect(inProgressCol).toContainText('e2e solo feature', { timeout: 8000 });

        // Agent section for cc should be visible (in-progress cards use .kcard-agent layout)
        const inProgressCard = inProgressCol.locator('.kcard').filter({ hasText: 'e2e solo feature' }).first();
        await expect(inProgressCard).toBeVisible();
        await expect(inProgressCard.locator('.kcard-agent.agent-cc')).toBeVisible({ timeout: 5000 });

        // ── Step 6: MockAgent runs in background ──────────────────────────────

        const desc = 'e2e-solo-feature';
        const worktreePath = path.join(ctx.worktreeBase, `feature-${paddedId}-cc-${desc}`);

        // Wait for the worktree to be created by feature-start
        await waitForPath(worktreePath, 15000);

        const agent = new MockAgent({
            featureId: paddedId,
            agentId: 'cc',
            desc,
            repoPath: ctx.tmpDir,
            delays: MOCK_DELAYS,
        });

        await agent.run();

        // ── Step 7: Force refresh and verify submitted status ─────────────────

        await forceRefresh(page);
        // Give Alpine a moment to re-render
        await page.waitForTimeout(500);

        // The agent section for cc should now show status-submitted
        const refreshedCard = inProgressCol.locator('.kcard').filter({ hasText: 'e2e solo feature' }).first();
        const submittedBadge = refreshedCard.locator('.kcard-agent.agent-cc .kcard-agent-status.status-submitted');
        await expect(submittedBadge).toBeVisible({ timeout: 8000 });

        // ── Step 8: Verify NO eval notification (solo mode) ──────────────────

        // Solo mode: no feature-eval action should appear on the card
        const evalBtn = refreshedCard.locator('.kcard-va-btn[data-va-action="feature-eval"]');
        await expect(evalBtn).toHaveCount(0);

        // ── Step 9: Click Accept & Close → feature moves to Done ─────────────

        const closeBtn = refreshedCard.locator('.kcard-va-btn[data-va-action="feature-close"]');
        await expect(closeBtn).toBeVisible({ timeout: 5000 });
        await expect(closeBtn).toContainText('Accept & Close');

        const [closeResp] = await Promise.all([
            page.waitForResponse('**/api/action'),
            closeBtn.click(),
        ]);
        const closeJson = await closeResp.json().catch(() => ({}));
        expect(closeJson.ok, `feature-close failed: ${closeJson.error || closeJson.stderr || ''}`).toBe(true);

        await page.waitForResponse('**/api/refresh');
        await page.waitForTimeout(500);

        // ── Step 10: Feature no longer in active columns ──────────────────────

        // Feature should not appear in inbox, backlog, or in-progress
        const activeFeatures = page.locator(
            '.kanban-col[data-stage="inbox"] .kcard, .kanban-col[data-stage="backlog"] .kcard, .kanban-col[data-stage="in-progress"] .kcard'
        ).filter({ hasText: 'e2e solo feature' });
        await expect(activeFeatures).toHaveCount(0, { timeout: 5000 });

        // ── Step 11: Console tab shows feature-close output ───────────────────

        await page.click('#tab-console');
        await page.waitForSelector('#console-view', { timeout: 5000 });
        const consoleView = page.locator('#console-view');
        await expect(consoleView).toContainText('feature-close', { timeout: 5000 });
    });
});
