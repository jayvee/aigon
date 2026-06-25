#!/usr/bin/env node
'use strict';

/**
 * REGRESSION (F446): mid-run quota merge dedupes writes; agent-resume refuses when pair still depleted.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, testAsync, withTempDir, withTempDirAsync, report } = require('../_helpers');

const quotaProbe = require('../../lib/quota-probe');
const agentRegistry = require('../../lib/agent-registry');
const quotaMidRun = require('../../lib/quota-mid-run-detector');
const { emittedDedupe, lastActivityByName } = quotaMidRun;
const { appendQuotaPausedDashboardActions } = require('../../lib/quota-dashboard-actions');

test('mergeMidRunDepletion skips duplicate quota.json churn', () => withTempDir((dir) => {
    const ag = agentRegistry.getAgent('ag');
    const raw = fs.readFileSync(
        path.join(__dirname, '..', 'fixtures', 'quota', 'gg-resource-exhausted.txt'),
        'utf8'
    );
    const classified = quotaProbe.classifyProbeResult(ag, { ok: false, stdout: raw });
    assert.strictEqual(classified.verdict, 'depleted');
    const first = quotaProbe.mergeMidRunDepletion(dir, 'ag', null, '(default)', raw, classified);
    assert.strictEqual(first.changed, true);
    const second = quotaProbe.mergeMidRunDepletion(dir, 'ag', null, '(default)', raw, classified);
    assert.strictEqual(second.changed, false);
}));

test('emit dedupe map tracks composite key', () => {
    emittedDedupe.clear();
    const k = ['feature', '446', 'gg', 'sess', 'google-resource-exhausted'].join('\u0001');
    emittedDedupe.set(k, { patternId: 'google-resource-exhausted', resetAt: null });
    assert.strictEqual(emittedDedupe.has(k), true);
});

function seedResumeFixture(dir, padded, { withModelOverride = false } = {}) {
    const wfDir = path.join(dir, '.aigon', 'workflows', 'features', padded);
    fs.mkdirSync(wfDir, { recursive: true });
    const specPath = path.join(dir, 'docs', 'specs', 'features', '03-in-progress', `feature-${padded}-test.md`);
    fs.writeFileSync(path.join(wfDir, 'snapshot.json'), JSON.stringify({
        featureId: padded, currentSpecState: 'implementing',
        agents: { ag: withModelOverride
            ? { status: 'running', modelOverride: { model: 'gemini-2.5-flash' } }
            : { status: 'running' } },
        ...(withModelOverride ? { specPath } : {}),
    }));
    if (withModelOverride) {
        fs.mkdirSync(path.dirname(specPath), { recursive: true });
        fs.writeFileSync(specPath, '# t\n');
    }
    fs.mkdirSync(path.join(dir, '.aigon', 'state'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.aigon', 'state', `feature-${padded}-ag.json`), JSON.stringify({
        agent: 'ag', status: 'quota-paused', priorQuotaStatus: 'implementing',
        updatedAt: new Date().toISOString(),
    }));
}

async function expectResumeRejection(dir, id, expectedCode) {
    const prevPath = process.env.AIGON_PROJECT_PATH;
    delete process.env.AIGON_PROJECT_PATH;
    try {
        const resume = require('../../lib/agent-resume');
        try {
            await resume.runAgentResume([id, 'ag'], { cwd: dir });
            assert.fail(`expected ${expectedCode}`);
        } catch (e) {
            assert.strictEqual(e.code, expectedCode);
        }
    } finally {
        if (prevPath !== undefined) process.env.AIGON_PROJECT_PATH = prevPath;
        else delete process.env.AIGON_PROJECT_PATH;
    }
}

testAsync('agent-resume refuses when sidecar is missing', async () => withTempDirAsync(async (dir) => {
    seedResumeFixture(dir, '43');
    await expectResumeRejection(dir, '43', 'NO_SIDECAR');
}));

testAsync('agent-resume refuses when quota.json still depleted', async () => withTempDirAsync(async (dir) => {
    seedResumeFixture(dir, '42', { withModelOverride: true });
    quotaProbe.writeQuotaState({
        schemaVersion: 1,
        agents: { ag: { models: { 'gemini-2.5-flash': {
            verdict: 'depleted',
            lastProbedAt: new Date().toISOString(),
            resetAt: new Date(Date.now() + 86400000).toISOString(),
        } } } },
    }, dir);
    await expectResumeRejection(dir, '42', 'QUOTA_DEPLETED');
}));

testAsync('F454: scanActiveSessions skips capture-pane when activity epoch is unchanged', async () => withTempDirAsync(async (dir) => {
    // Seed a sidecar so scanActiveSessions has work to do.
    const sessionsDir = path.join(dir, '.aigon', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    const sessionName = 'aigon-feature-77-cc';
    fs.writeFileSync(path.join(sessionsDir, `${sessionName}.json`), JSON.stringify({
        sessionName,
        agent: 'cc',
        entityType: 'f',
        entityId: '77',
        role: 'do',
        category: 'entity',
    }));

    // Reset the module-level cache so prior tests don't leak in.
    lastActivityByName.clear();

    let captureCalls = 0;
    const fixedActivityMap = new Map([[sessionName, 1714000000]]);
    const stubDeps = {
        listSessionActivities: () => fixedActivityMap,
        tmuxSessionExists: () => true,
        capturePaneText: () => { captureCalls += 1; return 'idle pane output'; },
        persistQuotaPause: () => false,
    };

    await quotaMidRun.scanActiveSessions(dir, stubDeps);
    assert.strictEqual(captureCalls, 1, 'first scan must read the pane');
    await quotaMidRun.scanActiveSessions(dir, stubDeps);
    assert.strictEqual(captureCalls, 1, 'second scan with same activity epoch must skip capture-pane');

    // Bump the activity epoch — capture-pane should run again.
    fixedActivityMap.set(sessionName, 1714000001);
    await quotaMidRun.scanActiveSessions(dir, stubDeps);
    assert.strictEqual(captureCalls, 2, 'capture-pane re-runs once activity epoch advances');

    lastActivityByName.clear();
}));

test('appendQuotaPausedDashboardActions emits quota Resume and Skip (F446 dashboard validActions)', () => withTempDir((dir) => {
    const merged = appendQuotaPausedDashboardActions(dir, 'feature', '9', {
        agents: { ag: { modelOverride: { model: 'gemini-2.5-flash' }, status: 'running' } },
    }, [{
        id: 'ag',
        status: 'quota-paused',
        quotaPausedResetAt: new Date(Date.now() + 3600000).toISOString(),
        modelOverride: null,
    }], []);
    const resume = merged.find(va => va.action === 'agent-resume');
    const skip = merged.find(va => va.action === 'drop-agent');
    assert.ok(resume && resume.metadata && resume.metadata.quotaPaused, 'resume action');
    assert.ok(skip && skip.metadata && skip.metadata.quotaPaused, 'skip action');
    assert.strictEqual(skip.label, 'Skip');
    assert.match(String(resume.command), /aigon agent-resume/);
}));

report();
