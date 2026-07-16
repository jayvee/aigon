// @ts-check
'use strict';

const { test, expect } = require('@playwright/test');

// F679: the gallery Cards and Pipeline views render through the production
// contract card renderer (templates/dashboard/js/contract-cards), so these
// assertions exercise the exact markup the dashboard preview renderer ships.

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-scenario-key="feature-autonomous-running"]')).toBeVisible();
});

test('contracts render autonomous and set hierarchy without duplicate activity', async ({ page }) => {
  await expect(page.locator('#diagnostics-count')).toHaveText('Complete');
  await expect(page.locator('[data-scenario-key]')).toHaveCount(67);

  const implementing = page.locator('[data-scenario-key="feature-autonomous-running"]');
  await expect(implementing.locator('.ccard-row')).toHaveCount(0);
  await expect(implementing.locator('.ccard-stage')).toHaveCount(4);
  await expect(implementing.locator('.ccard-peek')).toHaveCount(2);

  const reviewing = page.locator('[data-scenario-key="feature-autonomous-reviewing"]');
  const completedStage = reviewing.locator('.ccard-stage.is-complete').first();
  await expect(completedStage.locator('.ccard-peek')).toBeVisible();
  const positions = await reviewing.locator('.ccard-stage-status').evaluateAll(nodes => nodes.map(node => Math.round(node.getBoundingClientRect().right)));
  expect(new Set(positions).size).toBe(1);

  const set = page.locator('[data-scenario-key="set-running"]');
  await expect(set.locator('.ccard-set-current')).toContainText('F682 Recover interrupted runs');
  await expect(set.locator('.ccard-set-current .ccard-stage')).toHaveCount(4);
  await expect(set.locator('.ccard-set-current .ccard-row')).toHaveCount(0);

  const setHeader = page.locator('[data-scenario-key="set-ready"] .ccard-head');
  await expect(setHeader.locator('.ccard-key')).toHaveCount(0);
  await expect(setHeader.locator('.ccard-badge')).toHaveCount(0);
});

test('inbox set cards stay minimal — title and action only', async ({ page }) => {
  const inboxSet = page.locator('[data-scenario-key="set-inbox-members"]');
  await expect(inboxSet.locator('.ccard-title')).toHaveText('Autonomous recovery');
  await expect(inboxSet.locator('.ccard-state')).toHaveCount(0);
  await expect(inboxSet.locator('.ccard-set-progress')).toHaveCount(0);
  await expect(inboxSet.locator('.ccard-member')).toHaveCount(0);
  await expect(inboxSet.locator('.ccard-pill')).toHaveCount(0);
  await expect(inboxSet.locator('.kcard-va-btn[data-va-action="set-prioritise"]')).toBeVisible();
});

test('solo active cards use one Peek, one overflow, and no empty action footer', async ({ page }) => {
  const implementing = page.locator('[data-scenario-key="feature-implementing-solo_worktree"]');
  await expect(implementing.locator('.ccard-status-bar')).toHaveCount(1);
  await expect(implementing.locator('.ccard-peek')).toHaveCount(1);
  await expect(implementing.locator('.ccard-overflow')).toHaveCount(1);
  await expect(implementing.locator('.ccard-actions')).toHaveCount(0);
  await expect(implementing.locator('.ccard-overflow-item')).toHaveCount(4);

  const ready = page.locator('[data-scenario-key="feature-ready-solo_worktree"]');
  await expect(ready.locator('.ccard-overflow')).toHaveCount(1);
  await expect(ready.locator('.ccard-status-tools .ccard-overflow')).toHaveCount(1);
  await expect(ready.locator('.ccard-actions .ccard-overflow')).toHaveCount(0);
  await expect(ready.locator('.ccard-actions .ccard-action.is-primary')).toHaveText('Close');
});

test('set spec cycle status renders labeled pills with Peek inside', async ({ page }) => {
  const reviewRunning = page.locator('[data-scenario-key="set-spec-review-running"]');
  const activePill = reviewRunning.locator('.ccard-pill.is-active').first();
  await expect(activePill).toContainText('Spec review');
  await expect(activePill.locator('.ccard-peek')).toBeVisible();
  // No bare unlabeled Peek buttons outside a labeled pill, stage, or row.
  const barePeeks = await reviewRunning
    .locator('.ccard-peek:not(.ccard-pill .ccard-peek):not(.ccard-stage .ccard-peek):not(.ccard-row .ccard-peek):not(.ccard-run-head .ccard-peek)')
    .count();
  expect(barePeeks).toBe(0);
});

test('Peek opens deterministic live and saved session output', async ({ page }) => {
  const reviewing = page.locator('[data-scenario-key="feature-autonomous-reviewing"]');
  await reviewing.locator('.ccard-stage.is-complete .ccard-peek').first().click();
  await expect(page.locator('#drawer-title')).toHaveText('Session output');
  await expect(page.locator('.session-console-meta')).toContainText('Saved session output');
  await page.locator('#drawer-close-button').click();

  await reviewing.locator('.ccard-stage.is-running .ccard-peek').click();
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
  await expect(page.locator('[data-pipeline-column="in-progress"] .ccard.is-expanded').first()).toBeVisible();
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
