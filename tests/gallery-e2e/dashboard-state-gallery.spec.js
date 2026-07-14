// @ts-check
'use strict';

const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-scenario-key="feature-autonomous-running"]')).toBeVisible();
});

test('contracts render autonomous and set hierarchy without duplicate activity', async ({ page }) => {
  await expect(page.locator('#diagnostics-count')).toHaveText('Complete');
  await expect(page.locator('[data-scenario-key]')).toHaveCount(66);

  const implementing = page.locator('[data-scenario-key="feature-autonomous-running"]');
  await expect(implementing.locator('.activity-row')).toHaveCount(0);
  await expect(implementing.locator('.run-stage')).toHaveCount(4);
  await expect(implementing.locator('.peek-button')).toHaveCount(2);

  const reviewing = page.locator('[data-scenario-key="feature-autonomous-reviewing"]');
  const completedStage = reviewing.locator('.run-stage.complete').first();
  await expect(completedStage.locator('.peek-button')).toBeVisible();
  const positions = await reviewing.locator('.run-stage-agent').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().x));
  expect(new Set(positions.map(value => Math.round(value))).size).toBe(1);

  const set = page.locator('[data-scenario-key="set-running"]');
  await expect(set.locator('.set-current-run')).toContainText('F682 Recover interrupted runs');
  await expect(set.locator('.set-current-run .run-stage')).toHaveCount(4);
  await expect(set.locator('.set-current-run .activity-row')).toHaveCount(0);

  const setHeader = page.locator('[data-scenario-key="set-ready"] .card-title-row');
  await expect(setHeader.locator('.card-key')).toHaveCount(0);
  await expect(setHeader.locator('.mode-badge')).toHaveText('3 features');
});

test('Peek opens deterministic live and saved session output', async ({ page }) => {
  const reviewing = page.locator('[data-scenario-key="feature-autonomous-reviewing"]');
  await reviewing.locator('.run-stage.complete .peek-button').click();
  await expect(page.locator('#drawer-title')).toHaveText('Session output');
  await expect(page.locator('.session-console-meta')).toContainText('Saved session output');
  await page.locator('#drawer-close-button').click();

  await reviewing.locator('.run-stage.running .peek-button').click();
  await expect(page.locator('.session-console-meta')).toContainText('Live session');
});

test('mobile gallery has no horizontal document overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator('[data-scenario-key="set-running"]')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});

test('Pipeline fills the viewport and adapts card density to lifecycle stage', async ({ page }) => {
  await page.setViewportSize({ width: 1728, height: 1000 });
  await page.locator('[data-view="pipeline"]').click();
  await expect(page.locator('[data-dashboard-preview="pipeline"]')).toBeVisible();
  await expect(page.locator('.pipeline-column')).toHaveCount(6);
  await expect(page.locator('[data-pipeline-column="backlog"] .pipeline-card.compact')).toHaveCount(3);
  await expect(page.locator('[data-pipeline-column="in-progress"] .pipeline-card:not(.compact)')).toHaveCount(2);
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  expect(fits).toBe(true);
});

test('Monitor focuses live work and remains usable on mobile', async ({ page }) => {
  await page.locator('[data-view="monitor"]').click();
  await expect(page.locator('[data-dashboard-preview="monitor"]')).toBeVisible();
  await expect(page.locator('.monitor-item.attention')).toHaveCount(2);
  await expect(page.locator('.monitor-focus .run-stage')).toHaveCount(4);
  await expect(page.locator('.monitor-focus .run-stage .peek-button')).toHaveCount(2);
  await expect(page.locator('.monitor-focus .monitor-session')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.locator('[data-view="monitor"]').click();
  await expect(page.locator('.monitor-focus')).toBeVisible();
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  expect(fits).toBe(true);
});
