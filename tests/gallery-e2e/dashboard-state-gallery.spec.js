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
  // REGRESSION: F684 adds unavailable-origin and checkpoint-fallback continuity scenarios.
  await expect(page.locator('[data-scenario-key]')).toHaveCount(73);

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

  const setHeader = page.locator('[data-scenario-key="set-ready"] .ccard-feature-set > .ccard-head');
  await expect(setHeader.locator('.ccard-key')).toHaveCount(0);
  await expect(setHeader.locator('.ccard-kind')).toHaveText('Feature set');
  await expect(setHeader.locator('.ccard-badge')).toHaveText('3 features');
});

test('expanded set reference shows member dependencies and stable actions', async ({ page }) => {
  const readySet = page.locator('[data-scenario-key="set-ready"]');
  await expect(readySet.locator('.gallery-set-member')).toHaveCount(3);
  const members = readySet.locator('.gallery-set-member');
  await expect(members.nth(0).locator('[data-va-action="feature-start"]')).toHaveText('Start');
  await expect(members.nth(0).locator('[data-va-action="feature-start"]')).toBeEnabled();
  await expect(members.nth(1).locator('[data-va-action="feature-start"]')).toBeDisabled();
  const dependent = readySet.locator('.gallery-set-member').filter({ hasText: 'Expose recovery controls' });
  await expect(dependent.locator('.ccard-dependencies')).toContainText('Depends on');
  await expect(dependent.locator('.ccard-dependency-key')).toHaveText('F682');
  await expect(dependent.locator('.ccard-dependency-name')).toHaveText('Recover interrupted runs');
  const setActions = readySet.locator('.ccard-feature-set > .ccard-actions');
  await expect(setActions.locator('.ccard-action.is-primary')).toHaveText('Review specs');
  await expect(setActions.locator('.ccard-action:not(.is-primary)')).toHaveText('Start autonomous');
  const actionBoxes = await setActions.locator(':scope > *').evaluateAll(nodes => nodes.map(node => {
    const box = node.getBoundingClientRect();
    return { left: box.left, right: box.right, top: box.top };
  }));
  expect(actionBoxes.every((box, index) => index === 0 || box.left >= actionBoxes[index - 1].right)).toBe(true);
});

test('manual member work keeps the set in progress and surfaces the current card', async ({ page }) => {
  const set = page.locator('[data-scenario-key="set-manual-running"]');
  await expect(set.locator('.ccard-feature-set > .ccard-state')).toHaveText('In progress');
  await expect(set.locator('.ccard-set-current')).toContainText('F682');
  await expect(set.locator('.ccard-set-current')).toContainText('Implementing');
  await expect(set.locator('[data-va-action="set-autonomous-start"]')).toHaveCount(0);
  await expect(set.locator('[data-va-action="set-autonomous-stop"]')).toHaveCount(0);
});

test('inbox set cards identify the set and keep actions on one row', async ({ page }) => {
  const inboxSet = page.locator('[data-scenario-key="set-inbox-members"]');
  await expect(inboxSet.locator('.ccard-title')).toHaveText('Autonomous recovery');
  await expect(inboxSet.locator('.ccard-kind')).toHaveText('Feature set');
  await expect(inboxSet.locator('.ccard-badge')).toHaveText('3 features');
  await expect(inboxSet.locator('.ccard-state')).toHaveCount(0);
  await expect(inboxSet.locator('.ccard-set-progress')).toContainText('0 of 3');
  await expect(inboxSet.locator('.ccard-member')).toHaveCount(0);
  await expect(inboxSet.locator('.ccard-pill')).toHaveCount(0);
  await expect(inboxSet.locator('.kcard-va-btn[data-va-action="set-prioritise"]')).toBeVisible();
  const actionTops = await inboxSet.locator('.ccard-actions > *').evaluateAll(nodes => (
    nodes.map(node => Math.round(node.getBoundingClientRect().top))
  ));
  expect(new Set(actionTops).size).toBe(1);
});

test('dependencies read as neutral relationships rather than warnings', async ({ page }) => {
  const blocked = page.locator('[data-scenario-key="feature-backlog-blocked"]');
  const dependency = blocked.locator('.ccard-dependencies');
  await expect(dependency).toContainText('Depends on');
  await expect(dependency.locator('.ccard-dependency-key')).toHaveText('F672');
  await expect(dependency.locator('.ccard-dependency-name')).toHaveText('Dashboard security boundary');
  await expect(blocked.locator('.ccard-blockers')).toHaveCount(0);
  const colors = await dependency.evaluate((element) => ({
    color: getComputedStyle(element).color,
    background: getComputedStyle(element).backgroundColor,
    warning: getComputedStyle(element.closest('.ccard')).getPropertyValue('--cc-warn').trim(),
  }));
  expect(colors.background).toBe('rgba(0, 0, 0, 0)');
  expect(colors.color).not.toBe(colors.warning);
});

test('solo active cards separate session tools from card actions', async ({ page }) => {
  const implementing = page.locator('[data-scenario-key="feature-implementing-solo_worktree"]');
  await expect(implementing.locator('.ccard-status-bar')).toHaveCount(1);
  await expect(implementing.locator('.ccard-peek')).toHaveCount(1);
  await expect(implementing.locator('.ccard-overflow')).toHaveCount(2);
  await expect(implementing.locator('.ccard-actions')).toHaveCount(1);
  await expect(implementing.locator('.kcard-overflow-item')).toHaveCount(4);
  await expect(implementing.locator('.ccard-status-tools .ccard-session-open')).toHaveCount(1);
  await expect(implementing.locator('.ccard-status-tools .ccard-session-menu-toggle')).toHaveAttribute('aria-label', 'Session options');
  await expect(implementing.locator('.ccard-status-tools .kcard-overflow-item[data-va-action="feature-nudge"]')).toHaveCount(0);
  await expect(implementing.locator('.ccard-actions .kcard-overflow-item[data-va-action="feature-nudge"]')).toHaveCount(1);
  await expect(implementing.locator('.ccard-actions .kcard-overflow-toggle')).toHaveAttribute('aria-label', 'More card actions');
  await expect(implementing.locator('.ccard-actions .kcard-overflow-item[data-va-action="feature-reset"]')).toHaveCount(1);
  await expect(implementing.locator('.ccard-status-age')).toHaveText('9m');
  await expect(implementing.locator('.ccard-status-age')).toHaveAttribute('title', 'Implementation running for 9m');

  const ready = page.locator('[data-scenario-key="feature-ready-solo_worktree"]');
  await expect(ready.locator('.ccard-overflow')).toHaveCount(1);
  await expect(ready.locator('.ccard-status-tools .ccard-overflow')).toHaveCount(0);
  await expect(ready.locator('.ccard-actions .ccard-overflow')).toHaveCount(1);
  await expect(ready.locator('.ccard-actions .ccard-action.is-primary')).toHaveText('Close');
});

test('card-level closing state is not attached to an agent row', async ({ page }) => {
  const closing = page.locator('[data-scenario-key="feature-closing-solo_worktree"]');
  await expect(closing.locator('.ccard-state')).toHaveText('Closing');
  await expect(closing.locator('.ccard-status-bar')).toHaveCount(0);
  await expect(closing.locator('.ccard-blockers')).toHaveCount(0);
});

test('peer review activity aligns with the primary status row', async ({ page }) => {
  const review = page.locator('[data-scenario-key="feature-review-session-lost"]');
  const lefts = await review.locator('.ccard-state-dot, .ccard-row .ccard-dot').evaluateAll(nodes => (
    nodes.map(node => Math.round(node.getBoundingClientRect().left))
  ));
  expect(lefts.length).toBeGreaterThan(1);
  expect(new Set(lefts).size).toBe(1);
});

test('active code review states what is happening in consistent sentence case', async ({ page }) => {
  const card = page.locator('[data-scenario-key="feature-code_review_in_progress-solo_worktree"]');
  const review = card.locator('.ccard-row').filter({ hasText: 'CX' });
  await expect(review.locator('.ccard-row-note')).toHaveText('Reviewing code');
  await expect(review).not.toContainText('code review');
  expect(await review.locator('.ccard-dot').evaluate(node => getComputedStyle(node).animationName)).toBe('ccard-active-pulse');
});

test('completed code review is labeled by outcome and remains inspectable', async ({ page }) => {
  const ready = page.locator('[data-scenario-key="feature-implementing-ready-solo"]');
  const review = ready.locator('.ccard-row').filter({ hasText: 'OP' });
  const outcome = review.locator('.ccard-row-note');
  await expect(outcome).toHaveText('Implementation approved');
  expect(await outcome.evaluate(node => node.scrollWidth <= node.clientWidth && node.scrollHeight <= node.clientHeight)).toBe(true);
  await expect(review).not.toContainText('OP code review');
  await expect(review.locator('.ccard-dot')).toHaveClass(/is-ready/);
  await expect(review.locator('.ccard-peek')).toBeVisible();
  await expect(review.locator('.ccard-session-open')).toHaveAttribute('data-session-name', 'feature-implementing-ready-solo-review');
  await expect(ready.locator('.ccard-status-main .ccard-row-name')).toHaveText('CC');
  await expect(review.locator('.ccard-row-name')).toHaveText('OP');
  const agentLefts = await ready.locator('.ccard-status-main .ccard-row-name, .ccard-row .ccard-row-name').evaluateAll(nodes => (
    nodes.map(node => Math.round(node.getBoundingClientRect().left))
  ));
  const statusLefts = await ready.locator('.ccard-status-label, .ccard-row-note').evaluateAll(nodes => (
    nodes.map(node => Math.round(node.getBoundingClientRect().left))
  ));
  expect(new Set(agentLefts).size).toBe(1);
  expect(new Set(statusLefts).size).toBe(1);
  await expect(ready.locator('.ccard-actions .ccard-action.is-primary')).toHaveText('Close');
  await expect(ready.locator('.ccard-actions .ccard-action:not(.is-primary)')).toHaveText('Address review');
  await expect(ready.locator('.ccard-actions .kcard-overflow-item[data-va-action="feature-code-review"]')).toHaveCount(1);
  await expect(ready.locator('.ccard-actions .kcard-overflow-item[data-va-action="feature-reset"]')).toHaveCount(1);
  await expect(ready.locator('.ccard-status-tools .kcard-overflow-item[data-va-action="feature-nudge"]')).toHaveCount(0);
  await expect(ready.locator('.ccard-actions .kcard-overflow-item[data-va-action="feature-nudge"]')).toHaveCount(1);
  await expect(ready.locator('.ccard-status-tools .kcard-overflow-item[data-va-action="feature-reset"]')).toHaveCount(0);
});

test('address review changes the implementer row and consumes the action', async ({ page }) => {
  const active = page.locator('[data-scenario-key="feature-review-addressing"]');
  await expect(active.locator('.ccard-status-main')).toContainText('CC');
  await expect(active.locator('.ccard-status-label')).toHaveText('Addressing review');
  expect(await active.locator('.ccard-state-dot').evaluate(node => getComputedStyle(node).animationName)).toBe('ccard-active-pulse');
  expect(await active.locator('.ccard-row .ccard-dot').evaluate(node => getComputedStyle(node).animationName)).toBe('none');
  await expect(active.locator('[data-va-action="feature-code-revise"]')).toHaveCount(0);
  await expect(active.locator('[data-va-action="feature-close"]')).toHaveCount(0);

  const complete = page.locator('[data-scenario-key="feature-review-addressed"]');
  await expect(complete.locator('.ccard-status-label')).toHaveText('Revision complete');
  await expect(complete.locator('.ccard-context')).toHaveCount(0);
  await expect(complete.locator('[data-va-action="feature-code-revise"]')).toHaveCount(0);
  await expect(complete.locator('.ccard-action.is-primary')).toHaveAttribute('data-va-action', 'feature-close');
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
