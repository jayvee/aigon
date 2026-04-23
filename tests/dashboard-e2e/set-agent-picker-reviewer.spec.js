// @ts-check
'use strict';

/**
 * REGRESSION: "Choose set agents" must show implementers + reviewer (model/effort)
 * on one modal — documented with a screenshot.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CTX_FILE = path.join(os.tmpdir(), 'aigon-dashboard-e2e-ctx.json');

test('set agent picker shows reviewer row (screenshot)', async ({ page, baseURL }) => {
    const ctx = JSON.parse(fs.readFileSync(CTX_FILE, 'utf8'));
    const repoPath = ctx.tmpDir;
    await page.goto(baseURL || 'http://127.0.0.1:4119', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.showAgentPicker === 'function');
    await page.evaluate((rp) => {
        window.showAgentPicker('homepage-polish', 'set homepage-polish', {
            title: 'Choose set agents',
            submitLabel: 'Start set',
            repoPath: rp,
            taskType: 'implement',
            action: 'set-autonomous-start',
            collectTriplet: true,
            includeSetReviewer: true,
        });
    }, repoPath);
    const wrap = page.locator('#agent-picker-reviewer-wrap');
    await expect(wrap).toBeVisible();
    await expect(page.locator('#agent-picker-review-agent')).toBeVisible();
    await expect(page.locator('#agent-picker').getByText('Reviewer (optional)')).toBeVisible();
    const shotDir = path.join(__dirname, 'screenshots');
    fs.mkdirSync(shotDir, { recursive: true });
    const out = path.join(shotDir, 'set-agent-picker-with-reviewer.png');
    await page.screenshot({ path: out, fullPage: true });
    // Also attach the modal region for a crisp crop in reports
    await page.locator('#agent-picker .modal-box').screenshot({ path: path.join(shotDir, 'set-agent-picker-modal-crop.png') });
});
