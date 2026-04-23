#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, testAsync, withTempDirAsync, report } = require('../_helpers');
const { buildSetValidActions } = require('../../lib/feature-set-workflow-rules');
const { writeSetAutoState } = require('../../lib/auto-session-state');
const { collectRepoStatus, clearTierCache } = require('../../lib/dashboard-status-collector');
const { buildSetDepGraphSvg } = require('../../templates/dashboard/js/set-cards.js');

const FEATURE_FOLDERS = ['01-inbox', '02-backlog', '03-in-progress', '04-in-evaluation', '05-done', '06-paused'];

function ensureFeatureLayout(repo) {
    FEATURE_FOLDERS.forEach((folder) => {
        fs.mkdirSync(path.join(repo, 'docs', 'specs', 'features', folder), { recursive: true });
    });
    fs.mkdirSync(path.join(repo, '.aigon', 'workflows', 'features'), { recursive: true });
}

function writeFeatureSpec(repo, folder, file, frontmatter) {
    const fullPath = path.join(repo, 'docs', 'specs', 'features', folder, file);
    const lines = ['---'];
    Object.entries(frontmatter || {}).forEach(([key, value]) => {
        if (Array.isArray(value)) lines.push(`${key}: [${value.join(', ')}]`);
        else lines.push(`${key}: ${value}`);
    });
    lines.push('---', '', `# ${file}`, '');
    fs.writeFileSync(fullPath, lines.join('\n'));
}

function writeSnapshot(repo, featureId, lifecycle, stage) {
    const dir = path.join(repo, '.aigon', 'workflows', 'features', String(featureId));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'snapshot.json'), JSON.stringify({
        entityType: 'feature',
        featureId: String(featureId),
        currentSpecState: lifecycle,
        lifecycle,
        mode: 'solo_branch',
        agents: { cx: { status: 'running' } },
        createdAt: '2026-04-24T09:00:00Z',
        updatedAt: '2026-04-24T09:05:00Z',
        currentStage: stage,
    }, null, 2));
}

test('set action registry derives start, stop, resume, and reset eligibility', () => {
    // REGRESSION: set cards must derive action eligibility centrally instead of hardcoding button states in the frontend.
    const idle = buildSetValidActions({ slug: 'auth', status: 'idle', isComplete: false, autonomous: null }).map((action) => action.action);
    const running = buildSetValidActions({ slug: 'auth', status: 'running', isComplete: false, autonomous: { running: true } }).map((action) => action.action);
    const paused = buildSetValidActions({ slug: 'auth', status: 'paused-on-failure', isComplete: false, autonomous: { running: false } }).map((action) => action.action);

    assert.deepStrictEqual(idle, ['set-autonomous-start']);
    assert.deepStrictEqual(running, ['set-autonomous-stop', 'set-autonomous-reset']);
    assert.deepStrictEqual(paused, ['set-autonomous-resume', 'set-autonomous-reset']);
});

testAsync('collector builds set card payload with graph states and validActions', async () => {
    // REGRESSION: dashboard set cards must be read-side derived from collector data, including current feature, last event, and dep-graph node states.
    await withTempDirAsync('aigon-set-dashboard-', async (repo) => {
        ensureFeatureLayout(repo);
        writeFeatureSpec(repo, '05-done', 'feature-01-auth-foundation.md', { set: 'auth', goal: 'Ship auth flow' });
        writeFeatureSpec(repo, '02-backlog', 'feature-02-auth-ui.md', { set: 'auth', depends_on: ['01'] });
        writeFeatureSpec(repo, '03-in-progress', 'feature-03-auth-review.md', { set: 'auth', depends_on: ['02'] });
        writeSnapshot(repo, '02', 'backlog', 'backlog');
        writeSnapshot(repo, '03', 'ready_for_review', 'in-progress');
        await writeSetAutoState(repo, 'auth', {
            status: 'paused-on-failure',
            running: false,
            currentFeature: '03',
            failedFeature: '03',
            failed: ['03'],
            completed: ['01'],
            reason: 'review-failed',
            updatedAt: '2026-04-24T10:15:00Z',
        });

        clearTierCache(repo);
        const response = { summary: { implementing: 0, waiting: 0, submitted: 0, error: 0, total: 0 } };
        const repoStatus = collectRepoStatus(repo, response);
        const setCard = repoStatus.sets.find((item) => item.slug === 'auth');
        assert.ok(setCard, 'set card missing from collector payload');
        assert.deepStrictEqual(setCard.progress, { merged: 1, total: 3, percent: 33 });
        assert.strictEqual(setCard.status, 'paused-on-failure');
        assert.strictEqual(setCard.currentFeature.id, '03');
        assert.strictEqual(setCard.currentFeature.label, 'auth review');
        assert.strictEqual(setCard.lastEvent.label, 'Review Failed');
        assert.deepStrictEqual(setCard.validActions.map((action) => action.action), ['set-autonomous-resume', 'set-autonomous-reset']);

        const nodeStates = Object.fromEntries(setCard.depGraph.nodes.map((node) => [String(node.featureId || node.id), node.state]));
        assert.strictEqual(nodeStates['01'], 'done');
        assert.strictEqual(nodeStates['02'], 'backlog');
        assert.strictEqual(nodeStates['03'], 'failed');

        const graphSvg = buildSetDepGraphSvg(setCard.depGraph);
        assert.match(graphSvg, /data-node-id="01"[^>]*data-state="done"/);
        assert.match(graphSvg, /data-node-id="03"[^>]*data-state="failed"/);
        assert.match(graphSvg, /class="set-graph-edge"/);
    });
});

test('dashboard action runner accepts set autonomous commands', () => {
    // REGRESSION: set-card buttons must post through the same dashboard action endpoint and not get rejected by the interactive-action allowlist.
    const childProcess = require('child_process');
    const dashboardServerPath = require.resolve('../../lib/dashboard-server');
    const originalSpawnSync = childProcess.spawnSync;
    let seen = null;
    try {
        delete require.cache[dashboardServerPath];
        childProcess.spawnSync = (cmd, args, opts) => {
            seen = { cmd, args, opts };
            return { status: 0, stdout: '', stderr: '' };
        };
        const dashboardServer = require('../../lib/dashboard-server');
        const result = dashboardServer.runDashboardInteractiveAction({
            action: 'set-autonomous-start',
            args: ['auth'],
            repoPath: process.cwd(),
            registeredRepos: [],
            defaultRepoPath: process.cwd(),
        });
        assert.ok(result.ok);
        assert.ok(seen, 'expected dashboard action to invoke spawnSync');
        assert.ok(seen.args.includes('set-autonomous-start'));
        assert.ok(seen.args.includes('auth'));
    } finally {
        childProcess.spawnSync = originalSpawnSync;
        delete require.cache[dashboardServerPath];
    }
});

report();
