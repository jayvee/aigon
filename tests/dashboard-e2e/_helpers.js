// @ts-check
'use strict';
const { expect } = require('@playwright/test');
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { GIT_SAFE_ENV } = require('../_helpers');
const { buildTmuxSessionName } = require('../../lib/worktree');
const CTX_FILE = path.join(os.tmpdir(), 'aigon-dashboard-e2e-ctx.json');
const FAST = process.env.MOCK_DELAY === 'fast' || !!process.env.CI;
const SOLO_DELAYS = FAST
    ? { implementing: 600, submitted: 300 }
    : { implementing: 15000, submitted: 5000 };
const FLEET_CC_DELAYS = FAST ? { implementing: 800, submitted: 400 } : { implementing: 3000, submitted: 1500 };
const FLEET_GG_DELAYS = FAST ? { implementing: 1500, submitted: 400 } : { implementing: 8000, submitted: 1500 };
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
/** Locate the named feature in the backlog column and return its padded ID. */
async function prioritiseInboxFeature(page, featureName) {
    ensureFixtureOnMainBranch();
    const backlogCol = page.locator('.kanban-col[data-stage="backlog"]').first();
    await expect(backlogCol).toContainText(featureName, { timeout: 8000 });
    const card = backlogCol.locator('.kcard').filter({ hasText: featureName }).first();
    const idText = (await card.locator('.kcard-id, [data-feature-id]').first().textContent({ timeout: 2000 }).catch(() => '')) || '';
    const m = idText.match(/(\d+)/);
    expect(m && m[1], `could not read paddedId from backlog card for "${featureName}"`).toBeTruthy();
    return String(m[1]).padStart(2, '0');
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
async function createInboxFeatureViaUI(page, title) {
    // Drive the dashboard's `/api/action` endpoint directly (same path the
    // create modal posts to) so this exercises the dashboard write path
    // without the modal's repo-picker / agent-picker plumbing. The modal
    // itself is covered by manual smoke; the value here is the engine
    // bootstrap and the kanban re-render that follow.
    const ctx = readCtx();
    const slug = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const resp = await page.request.post(`http://127.0.0.1:${ctx.port}/api/action`, {
        data: { action: 'feature-create', args: [title], repoPath: ctx.tmpDir },
    });
    const json = await resp.json().catch(() => ({}));
    expect(resp.ok(), `feature-create failed: ${JSON.stringify(json)}`).toBe(true);
    await forceRefresh(page);
    await page.waitForTimeout(300);
    return slug;
}

async function prioritiseFromInboxViaUI(page, featureName) {
    const card = page.locator('.kanban-col[data-stage="inbox"]').first().locator('.kcard').filter({ hasText: featureName }).first();
    await clickCardAction(page, card, 'feature-prioritise', 'feature-prioritise');
    return prioritiseInboxFeature(page, featureName);
}

function readSnapshot(repoPath, paddedId) {
    const p = path.join(repoPath, '.aigon', 'workflows', 'features', String(parseInt(paddedId, 10)), 'snapshot.json');
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
}

async function expectSnapshotState(repoPath, paddedId, expectedLifecycle, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        last = readSnapshot(repoPath, paddedId);
        if (last && last.lifecycle === expectedLifecycle) return;
        await new Promise(r => setTimeout(r, 150));
    }
    throw new Error(`expectSnapshotState: feature ${paddedId} lifecycle=${last && last.lifecycle} expected=${expectedLifecycle}`);
}

function expectSpecAt(repoPath, idOrSlug, folder) {
    const dir = path.join(repoPath, 'docs', 'specs', 'features', folder.replace(/\/$/, ''));
    const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    const isNum = /^\d+$/.test(String(idOrSlug));
    const ok = files.some(f => f.endsWith('.md') && (isNum
        ? new RegExp(`^feature-0*${parseInt(idOrSlug, 10)}-.+\\.md$`).test(f)
        : f.includes(String(idOrSlug))));
    if (!ok) throw new Error(`expectSpecAt: no spec for "${idOrSlug}" in ${folder}; files=${files.join(',')}`);
}

function tmuxSessionFor(paddedId, agentId, repoPath, role = 'do') {
    return buildTmuxSessionName(parseInt(paddedId, 10), agentId, { repo: path.basename(path.resolve(repoPath)), role });
}

async function _pollPane(sessionName, regex, timeoutMs, tailOnly, label) {
    const deadline = Date.now() + timeoutMs;
    let last = '';
    while (Date.now() < deadline) {
        const r = spawnSync('tmux', ['capture-pane', '-p', '-t', sessionName, '-S', '-200'], { encoding: 'utf8', stdio: 'pipe' });
        if (r.status === 0) {
            last = String(r.stdout || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
            const target = tailOnly
                ? (last.split('\n').map(l => l.trim()).filter(Boolean).pop() || '')
                : last;
            if (regex.test(target)) return;
        }
        await new Promise(r => setTimeout(r, 200));
    }
    throw new Error(`${label}(${sessionName}, ${regex}) timeout in ${timeoutMs}ms\n--- pane ---\n${last}`);
}
const expectTmuxPaneContains = (s, r, t = 8000) => _pollPane(s, r, t, false, 'expectTmuxPaneContains');
const expectTmuxPaneIdleAfter = (s, r, t = 8000) => _pollPane(s, r, t, true, 'expectTmuxPaneIdleAfter');

module.exports = {
    CTX_FILE, SOLO_DELAYS, FLEET_CC_DELAYS, FLEET_GG_DELAYS, GIT_SAFE_ENV,
    readCtx, waitForPath, forceRefresh,
    gotoPipelineWithMockedSessions, prioritiseInboxFeature, startFeatureWithAgents,
    clickCardAction, expectFeatureClosed, expectConsoleHasAction,
    createInboxFeatureViaUI, prioritiseFromInboxViaUI,
    readSnapshot, expectSnapshotState, expectSpecAt,
    tmuxSessionFor, expectTmuxPaneContains, expectTmuxPaneIdleAfter,
};
