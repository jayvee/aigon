// @ts-check
'use strict';

/**
 * Shared helpers for dashboard e2e specs (solo, fleet, solo-branch).
 *
 * REGRESSION: one source of truth for navigation + prioritise + close
 * verification prevents per-spec drift like the fleet-lifecycle .status-running
 * assertion bug that hid for six days (commit cd784ebb, 2026-04-01).
 */

const { expect } = require('@playwright/test');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { GIT_SAFE_ENV } = require('../_helpers');

const CTX_FILE = path.join(os.tmpdir(), 'aigon-dashboard-e2e-ctx.json');
const FAST = process.env.MOCK_DELAY === 'fast' || !!process.env.CI;
const SOLO_DELAYS = FAST
    ? { implementing: 600, submitted: 300 }
    : { implementing: 15000, submitted: 5000 };
// Fleet asserts an intermediate state (cc submitted, gg still in flight) AND
// a final all-submitted state. Both observations need the dashboard poll
// cycle; fast delays race those cycles and flake. ~40s runtime.
const FLEET_CC_DELAYS = { implementing: 3000, submitted: 1500 };
const FLEET_GG_DELAYS = { implementing: 8000, submitted: 1500 };

function readCtx() {
    return JSON.parse(fs.readFileSync(CTX_FILE, 'utf8'));
}

function ensureFixtureOnMainBranch() {
    const ctx = readCtx();
    try {
        execSync('git checkout main', {
            cwd: ctx.tmpDir,
            stdio: 'pipe',
            encoding: 'utf8',
            env: process.env,
        });
    } catch (_) {
        // If the fixture is already on main or a prior test left conflicts,
        // the action response will still surface the real problem.
    }
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

/**
 * Force a server-side poll AND make the frontend re-fetch + re-render.
 *
 * The dashboard's `requestRefresh()` is scoped inside an IIFE and not exposed
 * on window, so we can't call it directly. Clicking #refresh-btn invokes it,
 * which calls /api/refresh, updates state.data with the response, and runs
 * render(). Without this the frontend's 10s natural poll is the only way to
 * pick up out-of-band changes (like a CLI feature-start), and 10s is longer
 * than the 8s default Playwright timeout.
 */
async function forceRefresh(page) {
    const [res] = await Promise.all([
        page.waitForResponse('**/api/refresh'),
        page.click('#refresh-btn'),
    ]);
    return res;
}

async function gotoPipelineWithMockedSessions(page) {
    await page.route('**/api/session/**', route => route.fulfill({ json: { ok: true, pid: 0 } }));
    await page.goto('/');
    await page.click('#tab-pipeline');
    await page.waitForSelector('.kanban', { timeout: 10000 });
}

/** Click Prioritise on the named inbox card; return the assigned padded ID. */
async function prioritiseInboxFeature(page, featureName) {
    ensureFixtureOnMainBranch();
    const inboxCard = page.locator('.kcard').filter({ hasText: featureName }).first();
    await expect(inboxCard).toBeVisible({ timeout: 8000 });
    const btn = inboxCard.locator('.kcard-va-btn[data-va-action="feature-prioritise"]');
    const [resp] = await Promise.all([page.waitForResponse('**/api/action'), btn.click()]);
    const json = await resp.json().catch(() => ({}));
    const idMatch = (json.stdout || '').match(/Assigned ID:\s*(\d+)/);
    expect(idMatch && idMatch[1], 'feature-prioritise should assign an ID').toBeTruthy();
    await page.waitForResponse('**/api/refresh');
    const backlogCol = page.locator('.kanban-col[data-stage="backlog"]').first();
    await expect(backlogCol).toContainText(featureName, { timeout: 8000 });
    return String(idMatch[1]).padStart(2, '0');
}

/** Open agent picker from a backlog card, check the given agent codes, submit. */
async function startFeatureWithAgents(page, featureName, agentIds) {
    const backlogCard = page.locator('.kcard').filter({ hasText: featureName }).first();
    const setupBtn = backlogCard.locator('.kcard-va-btn[data-va-action="feature-start"]');
    await expect(setupBtn).toBeVisible({ timeout: 5000 });
    await setupBtn.click();
    const picker = page.locator('#agent-picker');
    await expect(picker).toBeVisible({ timeout: 5000 });
    for (const id of agentIds) {
        await picker.locator(`input[value="${id}"]`).check();
    }
    const [resp] = await Promise.all([page.waitForResponse('**/api/action'), page.click('#agent-picker-submit')]);
    const json = await resp.json().catch(() => ({}));
    expect(json.ok, `feature-start failed: ${json.error || json.stderr || ''}`).toBe(true);
    await page.waitForResponse('**/api/refresh');
}

/** Click an action button on a card; assert the action response is ok. */
async function clickCardAction(page, card, action, label) {
    const btn = card.locator(`.kcard-va-btn[data-va-action="${action}"]`);
    await expect(btn).toBeVisible({ timeout: 5000 });
    const [resp] = await Promise.all([page.waitForResponse('**/api/action'), btn.click()]);
    const json = await resp.json().catch(() => ({}));
    expect(json.ok, `${label || action} failed: ${json.error || json.stderr || ''}`).toBe(true);
    await page.waitForResponse('**/api/refresh');
    await page.waitForTimeout(500);
}

/** Verify the named feature is no longer in any active column. */
async function expectFeatureClosed(page, featureName, extraStages = []) {
    const stages = ['inbox', 'backlog', 'in-progress', ...extraStages];
    const selector = stages.map(s => `.kanban-col[data-stage="${s}"] .kcard`).join(', ');
    await expect(page.locator(selector).filter({ hasText: featureName })).toHaveCount(0, { timeout: 5000 });
}

/** Verify the Logs tab shows the named action in its log. */
async function expectConsoleHasAction(page, action) {
    await page.click('#tab-logs');
    await page.waitForSelector('#logs-view', { timeout: 5000 });
    await expect(page.locator('#logs-view')).toContainText(action, { timeout: 5000 });
}

module.exports = {
    CTX_FILE, SOLO_DELAYS, FLEET_CC_DELAYS, FLEET_GG_DELAYS, GIT_SAFE_ENV,
    readCtx, waitForPath, forceRefresh,
    gotoPipelineWithMockedSessions, prioritiseInboxFeature, startFeatureWithAgents,
    clickCardAction, expectFeatureClosed, expectConsoleHasAction,
};
