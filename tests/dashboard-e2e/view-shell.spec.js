// @ts-check
'use strict';

/**
 * F626: view shell registry — tab round-trip visibility, chrome flags, localStorage restore.
 */

const { test, expect } = require('@playwright/test');
const { gotoPipelineWithMockedSessions } = require('./_helpers');

const VIEW_TABS = [
  { id: 'monitor', container: '#monitor-view', sidebar: true, header: true, alpine: true },
  { id: 'pipeline', container: '#pipeline-view', sidebar: true, header: true, alpine: true },
  { id: 'sessions', container: '#sessions-view', sidebar: true, header: false, alpine: false },
  { id: 'statistics', container: '#statistics-view', sidebar: true, header: false, alpine: false },
  { id: 'insights', container: '#insights-view', sidebar: false, header: false, alpine: false },
  { id: 'logs', container: '#logs-view', sidebar: false, header: false, alpine: false },
  { id: 'all-items', container: '#all-items-view', sidebar: false, header: false, alpine: false },
  { id: 'settings', container: '#settings-view', sidebar: false, header: false, alpine: false },
];

async function expectViewVisible(page, tab) {
  if (tab.alpine) {
    await expect(page.locator(tab.container)).toBeVisible({ timeout: 8000 });
  } else {
    await expect(page.locator(tab.container)).toBeVisible({ timeout: 8000 });
    const display = await page.locator(tab.container).evaluate(el => getComputedStyle(el).display);
    expect(display).not.toBe('none');
  }
}

async function expectViewHidden(page, tab) {
  if (tab.alpine) {
    await expect(page.locator(tab.container)).toBeHidden({ timeout: 3000 });
  } else {
    const display = await page.locator(tab.container).evaluate(el => getComputedStyle(el).display);
    expect(display).toBe('none');
  }
}

async function expectChromeFlags(page, tab) {
  const chrome = await page.evaluate(() => ({
    sidebarInline: document.getElementById('repo-sidebar')?.style.display || '',
    mobileInline: document.getElementById('repo-select-mobile')?.style.display || '',
    headerInline: document.getElementById('repo-header')?.style.display || '',
  }));

  if (tab.sidebar) {
    // Shell clears inline hide; sidebar may still be none when user collapsed it.
    expect(chrome.mobileInline).not.toBe('none');
  } else {
    expect(chrome.sidebarInline).toBe('none');
    expect(chrome.mobileInline).toBe('none');
  }

  if (tab.header) {
    // Header visibility is data-driven (hidden when selectedRepo is "all").
  } else {
    expect(chrome.headerInline).toBe('none');
  }
}

test.describe('F626 view shell unification', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => {
      if (msg.type() === 'error' && !msg.text().includes('favicon')) {
        throw new Error(`console error: ${msg.text()}`);
      }
    });
    await gotoPipelineWithMockedSessions(page);
  });

  test('all tabs round-trip with correct visibility and chrome @smoke', async ({ page }) => {
    for (const tab of VIEW_TABS) {
      await page.click(`#tab-${tab.id}`);
      await page.waitForTimeout(150);
      for (const other of VIEW_TABS) {
        if (other.id === tab.id) {
          await expectViewVisible(page, other);
        } else {
          await expectViewHidden(page, other);
        }
      }
      await expectChromeFlags(page, tab);
    }
  });

  test('localStorage restores last valid view and invalid falls back to pipeline', async ({ page }) => {
    await page.click('#tab-sessions');
    await expect(page.locator('#sessions-view')).toBeVisible({ timeout: 5000 });

    await page.evaluate(() => {
      const key = Object.keys(localStorage).find(k => k.endsWith('-view'));
      if (key) localStorage.setItem(key, 'sessions');
    });
    await page.reload();
    await page.waitForSelector('#tab-sessions.active', { timeout: 8000 });
    await expect(page.locator('#sessions-view')).toBeVisible();

    await page.evaluate(() => {
      const key = Object.keys(localStorage).find(k => k.endsWith('-view'));
      if (key) localStorage.setItem(key, 'not-a-real-view');
    });
    await page.reload();
    await page.waitForSelector('#tab-pipeline.active', { timeout: 8000 });
    await expect(page.locator('#pipeline-view')).toBeVisible();
  });
});
