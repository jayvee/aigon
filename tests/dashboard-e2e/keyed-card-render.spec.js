// @ts-check
'use strict';

/**
 * F625: keyed kanban reconciliation — overflow menus on untouched cards survive
 * unrelated store updates; changed cards replace DOM; bundle wrappers reconcile.
 */

const { test, expect } = require('@playwright/test');
const { gotoPipelineWithMockedSessions, readCtx, forceRefresh } = require('./_helpers');

const TARGET = 'e2e-keyed-menu';
const OTHER = 'e2e-keyed-other';
const TARGET_LABEL = 'e2e keyed menu';
const OTHER_LABEL = 'e2e keyed other';

test.describe('F625 keyed kanban card render', () => {
  test.beforeEach(async ({ page }) => {
    await gotoPipelineWithMockedSessions(page);
    await forceRefresh(page);
  });

  test('overflow menu stays open when another card updates @smoke', async ({ page }) => {
    const ctx = readCtx();
    const col = page.locator(`.kanban-col[data-stage="in-progress"][data-repo-path="${ctx.tmpDir}"]`).first();
    await page.evaluate(async ({ repoPath, target, other }) => {
      const store = window.Alpine.store('dashboard');
      const data = JSON.parse(JSON.stringify(store.data));
      const needle = String(repoPath).replace(/^\/private\/var\//, '/var/');
      (data.repos || []).filter(r => r && String(r.path).replace(/^\/private\/var\//, '/var/') === needle).forEach((repo) => {
        repo.features = (repo.features || []).filter(f => f.name !== target && f.name !== other);
        repo.features.push(
          {
            id: '901', name: target, stage: 'in-progress', specPath: '/tmp/a.md',
            agents: [{ id: 'cc', status: 'implementing', updatedAt: new Date().toISOString(), slashCommand: '/x' }],
            validActions: [{ action: 'feature-stop', label: 'End Session', agentId: 'cc', type: 'workflow' }],
          },
          {
            id: '902', name: other, stage: 'in-progress', specPath: '/tmp/b.md',
            agents: [{ id: 'cc', status: 'implementing', updatedAt: new Date().toISOString(), slashCommand: '/x' }],
            validActions: [{ action: 'feature-stop', label: 'End Session', agentId: 'cc', type: 'workflow' }],
          },
        );
      });
      (await import('/js/store.js')).replaceData(data);
    }, { repoPath: ctx.tmpDir, target: TARGET, other: OTHER });
    await page.waitForTimeout(100);

    const targetCard = col.locator('.kcard').filter({ hasText: TARGET_LABEL }).first();
    await expect(targetCard).toBeVisible({ timeout: 5000 });
    const toggle = targetCard.locator('.kcard-overflow-toggle').first();
    await expect(toggle).toBeVisible();
    await targetCard.evaluate(el => { window.__menuCardRef = el; });
    const otherCard = col.locator('.kcard').filter({ hasText: OTHER_LABEL }).first();
    await page.evaluate(el => { window.__otherFpBefore = el.dataset.kanbanFp; }, await otherCard.elementHandle());
    await toggle.click();
    await expect(targetCard.locator('.kcard-overflow-menu.open')).toBeVisible();

    await page.evaluate(async ({ repoPath, other }) => {
      const store = window.Alpine.store('dashboard');
      const data = JSON.parse(JSON.stringify(store.data));
      const needle = String(repoPath).replace(/^\/private\/var\//, '/var/');
      (data.repos || []).filter(r => r && String(r.path).replace(/^\/private\/var\//, '/var/') === needle).forEach((repo) => {
        const feature = (repo.features || []).find(f => f.name === other);
        feature.agents[0].status = 'waiting';
        feature.agents[0].updatedAt = new Date().toISOString();
      });
      (await import('/js/store.js')).replaceData(data);
    }, { repoPath: ctx.tmpDir, other: OTHER });
    await page.waitForTimeout(100);

    await expect(targetCard.locator('.kcard-overflow-menu.open')).toBeVisible();
    const menuCardSame = await page.evaluate(() => document.contains(window.__menuCardRef));
    expect(menuCardSame).toBe(true);
    const fpBefore = await page.evaluate(() => window.__otherFpBefore);
    const otherFpAfter = await otherCard.getAttribute('data-kanban-fp');
    expect(otherFpAfter).not.toBe(fpBefore);
  });

  test('unchanged card keeps DOM identity across unrelated update', async ({ page }) => {
    const ctx = readCtx();
    const col = page.locator(`.kanban-col[data-stage="in-progress"][data-repo-path="${ctx.tmpDir}"]`).first();
    await page.evaluate(async ({ repoPath, target, other }) => {
      const data = JSON.parse(JSON.stringify(window.Alpine.store('dashboard').data));
      const needle = String(repoPath).replace(/^\/private\/var\//, '/var/');
      (data.repos || []).filter(r => r && String(r.path).replace(/^\/private\/var\//, '/var/') === needle).forEach((repo) => {
        repo.features = (repo.features || []).filter(f => f.name !== target && f.name !== other);
        repo.features.push(
          {
            id: '911', name: target, stage: 'in-progress', specPath: '/tmp/a.md',
            agents: [{ id: 'cc', status: 'implementing', updatedAt: new Date().toISOString(), slashCommand: '/x' }],
            validActions: [],
          },
          {
            id: '912', name: other, stage: 'in-progress', specPath: '/tmp/b.md',
            agents: [{ id: 'cc', status: 'implementing', updatedAt: new Date().toISOString(), slashCommand: '/x' }],
            validActions: [],
          },
        );
      });
      (await import('/js/store.js')).replaceData(data);
    }, { repoPath: ctx.tmpDir, target: TARGET, other: OTHER });
    await page.waitForTimeout(100);

    const stableCard = col.locator('.kcard').filter({ hasText: TARGET_LABEL }).first();
    await expect(stableCard).toBeVisible();
    await stableCard.evaluate(el => { window.__stableCardRef = el; });

    await page.evaluate(async ({ repoPath, other }) => {
      const data = JSON.parse(JSON.stringify(window.Alpine.store('dashboard').data));
      const needle = String(repoPath).replace(/^\/private\/var\//, '/var/');
      (data.repos || []).filter(r => r && String(r.path).replace(/^\/private\/var\//, '/var/') === needle).forEach((repo) => {
        const feature = (repo.features || []).find(f => f.name === other);
        feature.agents[0].status = 'waiting';
      });
      (await import('/js/store.js')).replaceData(data);
    }, { repoPath: ctx.tmpDir, other: OTHER });
    await page.waitForTimeout(100);

    const stableSame = await page.evaluate(() => {
      return document.contains(window.__stableCardRef);
    });
    expect(stableSame).toBe(true);
  });

  test('set bundle wrapper reconciles member cards', async ({ page }) => {
    const ctx = readCtx();
    const col = page.locator(`.kanban-col[data-stage="backlog"][data-repo-path="${ctx.tmpDir}"]`).first();
    await page.click('.pipeline-group-toggle');
    await page.evaluate(async ({ repoPath }) => {
      const data = JSON.parse(JSON.stringify(window.Alpine.store('dashboard').data));
      const needle = String(repoPath).replace(/^\/private\/var\//, '/var/');
      (data.repos || []).filter(r => r && String(r.path).replace(/^\/private\/var\//, '/var/') === needle).forEach((repo) => {
        repo.sets = [{ slug: 'e2e-set', memberCount: 2, completed: 0, validActions: [] }];
        repo.features = [
          {
            id: '1', name: 'e2e-set-one', stage: 'backlog', set: 'e2e-set', specPath: '/tmp/1.md',
            agents: [], validActions: [{ action: 'feature-start', label: 'Start', type: 'transition', to: 'in-progress' }],
          },
          {
            id: '2', name: 'e2e-set-two', stage: 'backlog', set: 'e2e-set', specPath: '/tmp/2.md',
            agents: [], validActions: [{ action: 'feature-start', label: 'Start', type: 'transition', to: 'in-progress' }],
          },
        ];
      });
      (await import('/js/store.js')).replaceData(data);
    }, { repoPath: ctx.tmpDir });
    await page.waitForTimeout(100);

    const bundle = col.locator('.kanban-set-bundle').filter({ hasText: 'e2e-set' }).first();
    await expect(bundle).toBeVisible({ timeout: 5000 });
    await bundle.evaluate(el => { window.__bundleRef = el; });
    const cardTwo = bundle.locator('.kcard').filter({ hasText: 'e2e set two' });
    await cardTwo.evaluate(el => { window.__cardTwoRef = el; });

    await page.evaluate(async ({ repoPath }) => {
      const data = JSON.parse(JSON.stringify(window.Alpine.store('dashboard').data));
      const needle = String(repoPath).replace(/^\/private\/var\//, '/var/');
      (data.repos || []).filter(r => r && String(r.path).replace(/^\/private\/var\//, '/var/') === needle).forEach((repo) => {
        const feature = (repo.features || []).find(f => f.name === 'e2e-set-two');
        feature.name = 'e2e-set-two-renamed';
      });
      (await import('/js/store.js')).replaceData(data);
    }, { repoPath: ctx.tmpDir });
    await page.waitForTimeout(100);

    const bundleSame = await page.evaluate(() => document.contains(window.__bundleRef));
    const cardTwoReplaced = await page.evaluate(() => !document.contains(window.__cardTwoRef));
    expect(bundleSame).toBe(true);
    expect(cardTwoReplaced).toBe(true);
    await expect(bundle.locator('.kcard').filter({ hasText: 'e2e set two renamed' })).toBeVisible();
  });

  test('overflow cap keeps full set visible when group-by-set is on @smoke', async ({ page }) => {
    const ctx = readCtx();
    const col = page.locator(`.kanban-col[data-stage="backlog"][data-repo-path="${ctx.tmpDir}"]`).first();
    await page.click('.pipeline-group-toggle');
    await page.evaluate(async ({ repoPath }) => {
      const data = JSON.parse(JSON.stringify(window.Alpine.store('dashboard').data));
      const needle = String(repoPath).replace(/^\/private\/var\//, '/var/');
      (data.repos || []).filter(r => r && String(r.path).replace(/^\/private\/var\//, '/var/') === needle).forEach((repo) => {
        repo.sets = [{ slug: 'overflow-set', memberCount: 5, completed: 0, validActions: [] }];
        const filler = Array.from({ length: 7 }, (_, i) => ({
          id: String(800 + i),
          name: `overflow-filler-${i}`,
          stage: 'backlog',
          specPath: `/tmp/filler-${i}.md`,
          agents: [],
          validActions: [{ action: 'feature-start', label: 'Start', type: 'transition', to: 'in-progress' }],
        }));
        const members = Array.from({ length: 5 }, (_, i) => ({
          id: String(900 + i),
          name: `overflow-set-member-${i}`,
          stage: 'backlog',
          set: 'overflow-set',
          specPath: `/tmp/set-${i}.md`,
          agents: [],
          validActions: [{ action: 'feature-start', label: 'Start', type: 'transition', to: 'in-progress' }],
        }));
        repo.features = [...filler, ...members];
      });
      (await import('/js/store.js')).replaceData(data);
    }, { repoPath: ctx.tmpDir });
    await page.waitForTimeout(100);

    const bundle = col.locator('.kanban-set-bundle').filter({ hasText: 'overflow-set' }).first();
    await expect(bundle).toBeVisible({ timeout: 5000 });
    await expect(bundle.locator('.kcard')).toHaveCount(5);
  });
});
