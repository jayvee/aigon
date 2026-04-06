// @ts-check
'use strict';

/**
 * E2E: Fleet mode lifecycle via dashboard.
 *
 * Exercises the fleet (multi-agent) happy path through the dashboard UI:
 *   inbox → Prioritise → backlog → Start feature (cc + gg) → in-progress →
 *   Two MockAgents run with staggered delays → partial then full submitted →
 *   Run eval → feature moves to in-evaluation → write winner →
 *   Close with cc → done
 *
 * Requires GEMINI_CLI=1 in the dashboard's env (set in globalSetup) so that
 * `aigon feature-eval` runs in eval-setup mode without launching a real agent.
 *
 * Run: npx playwright test --config tests/dashboard-e2e/playwright.config.js fleet-lifecycle
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { MockAgent } = require('../integration/mock-agent');

const CTX_FILE = path.join(os.tmpdir(), 'aigon-dashboard-e2e-ctx.json');
const { spawnSync } = require('child_process');

// Fleet mode asserts an intermediate state (cc submitted, gg still running)
// AND a final all-submitted state. Both checks need the dashboard poll +
// engine signal flush cycle to observe transitions reliably. Fast delays
// race those cycles and produce flakes. This test uses realistic delays
// unconditionally — it is not worth pretending it can run in a second.
// Total runtime ~40s; acceptable for a pre-push check.
const CC_DELAYS = { implementing: 3000, submitted: 1500 };
const GG_DELAYS = { implementing: 8000, submitted: 1500 };

function readCtx() {
    return JSON.parse(fs.readFileSync(CTX_FILE, 'utf8'));
}

function waitForPath(p, timeoutMs = 15000) {
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

async function forceRefresh(page) {
    const [res] = await Promise.all([
        page.waitForResponse('**/api/refresh'),
        page.evaluate(() => fetch('/api/refresh', { method: 'POST', cache: 'no-store' })),
    ]);
    return res;
}

function runGit(args, cwd) {
    spawnSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
}

test.describe('Fleet mode lifecycle', () => {
    test('full fleet lifecycle: inbox → setup cc+gg → submit both → eval → close cc → done', async ({ page }) => {
        const ctx = readCtx();

        // Mock session/run to prevent tmux terminal opening
        await page.route('**/api/session/**', route => route.fulfill({ json: { ok: true, pid: 0 } }));

        // ── Step 1: Navigate to Pipeline tab ──────────────────────────────────

        await page.goto('/');
        await page.click('#tab-pipeline');
        await page.waitForSelector('.kanban', { timeout: 10000 });

        // ── Step 2: Prioritise e2e-fleet-feature ──────────────────────────────

        const inboxCard = page.locator('.kcard').filter({ hasText: 'e2e fleet feature' }).first();
        await expect(inboxCard).toBeVisible({ timeout: 8000 });

        const prioritiseBtn = inboxCard.locator('.kcard-va-btn[data-va-action="feature-prioritise"]');
        const [prioResp] = await Promise.all([
            page.waitForResponse('**/api/action'),
            prioritiseBtn.click(),
        ]);
        const prioJson = await prioResp.json().catch(() => ({}));
        const idMatch = (prioJson.stdout || '').match(/Assigned ID:\s*(\d+)/);
        const featureId = idMatch ? idMatch[1] : null;
        const paddedId = featureId ? String(featureId).padStart(2, '0') : null;
        expect(featureId, 'feature-prioritise should assign an ID').toBeTruthy();

        await page.waitForResponse('**/api/refresh');

        const backlogCol = page.locator('.kanban-col[data-stage="backlog"]').first();
        await expect(backlogCol).toContainText('e2e fleet feature', { timeout: 8000 });

        // ── Step 3: Start feature → agent picker → select cc AND gg ──────────

        const backlogCard = page.locator('.kcard').filter({ hasText: 'e2e fleet feature' }).first();
        const setupBtn = backlogCard.locator('.kcard-va-btn[data-va-action="feature-start"]');
        await expect(setupBtn).toBeVisible();
        await setupBtn.click();

        const agentPicker = page.locator('#agent-picker');
        await expect(agentPicker).toBeVisible({ timeout: 5000 });

        // Select both cc and gg
        await agentPicker.locator('input[value="cc"]').check();
        await agentPicker.locator('input[value="gg"]').check();
        await expect(agentPicker.locator('input[value="cc"]')).toBeChecked();
        await expect(agentPicker.locator('input[value="gg"]')).toBeChecked();

        const [setupResp] = await Promise.all([
            page.waitForResponse('**/api/action'),
            page.click('#agent-picker-submit'),
        ]);
        const setupJson = await setupResp.json().catch(() => ({}));
        expect(setupJson.ok, `feature-start failed: ${setupJson.error || setupJson.stderr || ''}`).toBe(true);

        await page.waitForResponse('**/api/refresh');

        // ── Step 4: Feature in In-Progress with both agents implementing ───────

        const inProgressCol = page.locator('.kanban-col[data-stage="in-progress"]').first();
        await expect(inProgressCol).toContainText('e2e fleet feature', { timeout: 8000 });

        const inProgressCard = inProgressCol.locator('.kcard').filter({ hasText: 'e2e fleet feature' }).first();
        // Both agent sections should appear (in-progress cards use .kcard-agent layout)
        const agentSections = inProgressCard.locator('.kcard-agent');
        await expect(agentSections).toHaveCount(2, { timeout: 5000 });
        await expect(agentSections.first()).toBeVisible();

        // ── Step 5: Run two MockAgents with staggered delays ──────────────────

        const desc = 'e2e-fleet-feature';
        const ccWorktreePath = path.join(ctx.worktreeBase, `feature-${paddedId}-cc-${desc}`);
        const ggWorktreePath = path.join(ctx.worktreeBase, `feature-${paddedId}-gg-${desc}`);
        // Wait for the log files specifically — the worktree dir is created early by `git worktree add`
        // but the log file is written later (after install-agent). MockAgent needs the log file.
        const ccLogPath = path.join(ccWorktreePath, 'docs', 'specs', 'features', 'logs', `feature-${paddedId}-cc-${desc}-log.md`);
        const ggLogPath = path.join(ggWorktreePath, 'docs', 'specs', 'features', 'logs', `feature-${paddedId}-gg-${desc}-log.md`);

        await Promise.all([
            waitForPath(ccLogPath, 30000),
            waitForPath(ggLogPath, 30000),
        ]);

        const agentCC = new MockAgent({
            featureId: paddedId,
            agentId: 'cc',
            desc,
            repoPath: ctx.tmpDir,
            worktreeBase: ctx.worktreeBase,
            delays: CC_DELAYS,
        });
        const agentGG = new MockAgent({
            featureId: paddedId,
            agentId: 'gg',
            desc,
            repoPath: ctx.tmpDir,
            worktreeBase: ctx.worktreeBase,
            delays: GG_DELAYS,
        });

        // Start both agents — cc finishes first
        const ccRunning = agentCC.run();
        const ggRunning = agentGG.run();

        await ccRunning;

        // Intermediate state: cc submitted, gg still implementing
        await forceRefresh(page);
        await page.waitForTimeout(500);

        const ccSubmitted = inProgressCard.locator('.kcard-agent.agent-cc .kcard-agent-status.status-submitted');
        await expect(ccSubmitted).toBeVisible({ timeout: 5000 });

        const ggStillRunning = inProgressCard.locator('.kcard-agent.agent-gg .kcard-agent-status.status-running');
        await expect(ggStillRunning).toBeVisible({ timeout: 5000 });

        await ggRunning;

        // ── Step 6: Both submitted — verify all-submitted state ───────────────

        // Give the async engine signal from MockAgent's CLI call time to
        // flush through the event log before the dashboard re-reads. One
        // force-refresh is not enough because the signal emission is
        // promise-based and races the poll.
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

        // Feature-close (solo-only) should NOT appear in fleet mode
        const soloCloseBtn = inProgressCard.locator('.kcard-va-btn[data-va-action="feature-close"]');
        await expect(soloCloseBtn).toHaveCount(0);

        // ── Step 7: Run eval via dashboard action ─────────────────────────────

        // Clicking "Evaluate" opens the agent-picker modal — pick cc to
        // evaluate, then submit. The API call fires on submit, not on the
        // initial click.
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

        // Feature should now be in in-evaluation
        const inEvalCol = page.locator('.kanban-col[data-stage="in-evaluation"]').first();
        await expect(inEvalCol).toContainText('e2e fleet feature', { timeout: 8000 });

        // ── Step 8: Simulate eval result — write winner to eval file ──────────

        const evalDir = path.join(ctx.tmpDir, 'docs', 'specs', 'features', 'evaluations');
        const evalFile = path.join(evalDir, `feature-${paddedId}-eval.md`);
        await waitForPath(evalFile, 5000);

        const existingEval = fs.readFileSync(evalFile, 'utf8');
        fs.writeFileSync(evalFile, existingEval + '\n**Winner: cc**\n');

        // Also bring gg's log into the main repo (flat logs/ directory)
        const mainLogsDir = path.join(ctx.tmpDir, 'docs', 'specs', 'features', 'logs');
        const ggLogSrc = path.join(ggWorktreePath, 'docs', 'specs', 'features', 'logs',
            `feature-${paddedId}-gg-${desc}-log.md`);
        const ggLogDest = path.join(mainLogsDir, `feature-${paddedId}-gg-${desc}-log.md`);
        fs.mkdirSync(mainLogsDir, { recursive: true });
        fs.copyFileSync(ggLogSrc, ggLogDest);

        runGit(['add', 'docs/specs/features/'], ctx.tmpDir);
        runGit(['commit', '-m', `chore: write eval results for feature ${paddedId}`], ctx.tmpDir);

        // ── Step 9: Close with winner (cc) via dashboard ──────────────────────

        await forceRefresh(page);
        await page.waitForTimeout(500);

        const inEvalCard = inEvalCol.locator('.kcard').filter({ hasText: 'e2e fleet feature' }).first();
        await expect(inEvalCard).toBeVisible({ timeout: 5000 });

        const fleetCloseBtn = inEvalCard.locator('.kcard-va-btn[data-va-action="feature-close"]');
        await expect(fleetCloseBtn).toBeVisible({ timeout: 5000 });

        await fleetCloseBtn.click();

        // Fleet close opens the "Close & Merge" modal — select winner
        // via radio group in `#close-modal-winners`, then submit.
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

        // ── Step 10: Feature no longer in active columns ──────────────────────

        const activeFeatures = page.locator(
            '.kanban-col[data-stage="inbox"] .kcard, .kanban-col[data-stage="backlog"] .kcard, .kanban-col[data-stage="in-progress"] .kcard, .kanban-col[data-stage="in-evaluation"] .kcard'
        ).filter({ hasText: 'e2e fleet feature' });
        await expect(activeFeatures).toHaveCount(0, { timeout: 5000 });

        // ── Step 11: Console tab shows feature-close output ───────────────────

        await page.click('#tab-console');
        await page.waitForSelector('#console-view', { timeout: 5000 });
        await expect(page.locator('#console-view')).toContainText('feature-close', { timeout: 5000 });
    });
});
