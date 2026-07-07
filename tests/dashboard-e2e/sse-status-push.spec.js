// @ts-check
'use strict';

/**
 * F622: SSE status push — live connection, push-triggered fetch, blocked fallback.
 */

const { test, expect } = require('@playwright/test');
const { gotoPipelineWithMockedSessions } = require('./_helpers');

const FEATURE_NAME = 'e2e solo feature';

test.describe('F622 SSE status push', () => {
    test('EventSource receives status event and health shows live @smoke', async ({ page }) => {
        await page.goto('/');
        const version = await page.evaluate(async () => {
            return new Promise((resolve, reject) => {
                const es = new EventSource('/api/events');
                const timer = setTimeout(() => {
                    es.close();
                    reject(new Error('SSE status event timeout'));
                }, 8000);
                es.addEventListener('status', (ev) => {
                    clearTimeout(timer);
                    es.close();
                    resolve(JSON.parse(ev.data).statusVersion);
                }, { once: true });
                es.addEventListener('error', () => {
                    clearTimeout(timer);
                    es.close();
                    reject(new Error('SSE connection error'));
                }, { once: true });
            });
        });
        expect(version).toBeGreaterThanOrEqual(0);

        await page.waitForFunction(() => {
            const t = document.getElementById('health-text');
            return t && t.textContent === 'Connected (live)';
        }, null, { timeout: 8000 });
    });

    test('SSE open triggers extra status fetch while poll interval blocked @smoke', async ({ page }) => {
        await page.addInitScript(() => {
            const orig = window.setInterval;
            window.setInterval = function (fn, ms) {
                if (ms >= 10000) return -1;
                return orig.apply(this, arguments);
            };
        });

        let statusGets = 0;
        await page.route('**/api/status', async route => {
            statusGets += 1;
            return route.continue();
        });

        await gotoPipelineWithMockedSessions(page);

        await page.waitForFunction(() => {
            const t = document.getElementById('health-text');
            return t && t.textContent === 'Connected (live)';
        }, null, { timeout: 10000 });

        // Initial poll (setTimeout 400ms) + SSE-open triggered fetch — no interval polls.
        expect(statusGets).toBeGreaterThanOrEqual(2);
        expect(statusGets).toBeLessThanOrEqual(4);
    });

    test('SSE blocked falls back to poll without breaking dashboard @smoke', async ({ page }) => {
        await page.route('**/api/events', route => route.abort());
        await gotoPipelineWithMockedSessions(page);

        await page.waitForFunction(() => {
            const t = document.getElementById('health-text');
            return t && t.textContent && t.textContent.includes('Connected');
        }, null, { timeout: 15000 });

        const warnings = [];
        page.on('console', msg => {
            if (msg.type() === 'warning' && String(msg.text()).includes('SSE')) warnings.push(msg.text());
        });

        await page.waitForTimeout(1500);
        expect(warnings.length).toBeLessThanOrEqual(1);

        const backlogCol = page.locator('.kanban-col[data-stage="backlog"]').first();
        await expect(backlogCol).toContainText(FEATURE_NAME, { timeout: 12000 });
    });
});
