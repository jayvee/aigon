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
const { emittedDedupe } = require('../../lib/quota-mid-run-detector');
const { appendQuotaPausedDashboardActions } = require('../../lib/quota-dashboard-actions');

test('mergeMidRunDepletion skips duplicate quota.json churn', () => withTempDir((dir) => {
    const gg = agentRegistry.getAgent('gg');
    const raw = fs.readFileSync(
        path.join(__dirname, '..', 'fixtures', 'quota', 'gg-resource-exhausted.txt'),
        'utf8'
    );
    const classified = quotaProbe.classifyProbeResult(gg, { ok: false, stdout: raw });
    assert.strictEqual(classified.verdict, 'depleted');
    const first = quotaProbe.mergeMidRunDepletion(dir, 'gg', null, '(default)', raw, classified);
    assert.strictEqual(first.changed, true);
    const second = quotaProbe.mergeMidRunDepletion(dir, 'gg', null, '(default)', raw, classified);
    assert.strictEqual(second.changed, false);
}));

test('emit dedupe map tracks composite key', () => {
    emittedDedupe.clear();
    const k = ['feature', '446', 'gg', 'sess', 'google-resource-exhausted'].join('\u0001');
    emittedDedupe.set(k, { patternId: 'google-resource-exhausted', resetAt: null });
    assert.strictEqual(emittedDedupe.has(k), true);
});

testAsync('agent-resume refuses when sidecar is missing', async () => withTempDirAsync(async (dir) => {
    const prevPath = process.env.AIGON_PROJECT_PATH;
    delete process.env.AIGON_PROJECT_PATH;
    const id = '43';
    const padded = id.padStart(2, '0');
    const wfDir = path.join(dir, '.aigon', 'workflows', 'features', padded);
    fs.mkdirSync(wfDir, { recursive: true });
    fs.writeFileSync(path.join(wfDir, 'snapshot.json'), JSON.stringify({
        featureId: padded,
        currentSpecState: 'implementing',
        agents: { gg: { status: 'running' } },
    }));
    fs.mkdirSync(path.join(dir, '.aigon', 'state'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.aigon', 'state', `feature-${padded}-gg.json`), JSON.stringify({
        agent: 'gg',
        status: 'quota-paused',
        priorQuotaStatus: 'implementing',
        updatedAt: new Date().toISOString(),
    }));
    const resume = require('../../lib/agent-resume');
    let code;
    try {
        try {
            await resume.runAgentResume([id, 'gg'], { cwd: dir });
        } catch (e) {
            code = e.code;
            assert.strictEqual(code, 'NO_SIDECAR');
        }
        assert.ok(code, 'expected NO_SIDECAR');
    } finally {
        if (prevPath !== undefined) process.env.AIGON_PROJECT_PATH = prevPath;
        else delete process.env.AIGON_PROJECT_PATH;
    }
}));

testAsync('agent-resume refuses when quota.json still depleted', async () => withTempDirAsync(async (dir) => {
    const prevPath = process.env.AIGON_PROJECT_PATH;
    delete process.env.AIGON_PROJECT_PATH;
    const id = '42';
    const padded = id.padStart(2, '0');
    const model = 'gemini-2.5-pro';
    const wfDir = path.join(dir, '.aigon', 'workflows', 'features', padded);
    fs.mkdirSync(wfDir, { recursive: true });
    fs.writeFileSync(path.join(wfDir, 'snapshot.json'), JSON.stringify({
        featureId: padded,
        currentSpecState: 'implementing',
        agents: {
            gg: { status: 'running', modelOverride: { model } },
        },
        specPath: path.join(dir, 'docs', 'specs', 'features', '03-in-progress', `feature-${padded}-test.md`),
    }));
    fs.mkdirSync(path.join(dir, 'docs', 'specs', 'features', '03-in-progress'), { recursive: true });
    fs.writeFileSync(
        path.join(dir, 'docs', 'specs', 'features', '03-in-progress', `feature-${padded}-test.md`),
        '# t\n'
    );
    const quotaState = {
        schemaVersion: 1,
        agents: {
            gg: {
                models: {
                    [model]: {
                        verdict: 'depleted',
                        lastProbedAt: new Date().toISOString(),
                        resetAt: new Date(Date.now() + 86400000).toISOString(),
                    },
                },
            },
        },
    };
    fs.mkdirSync(path.join(dir, '.aigon', 'state'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.aigon', 'state', `feature-${padded}-gg.json`), JSON.stringify({
        agent: 'gg',
        status: 'quota-paused',
        priorQuotaStatus: 'implementing',
        updatedAt: new Date().toISOString(),
    }));
    quotaProbe.writeQuotaState(quotaState, dir);

    const resume = require('../../lib/agent-resume');
    let code;
    try {
        try {
            await resume.runAgentResume([id, 'gg'], { cwd: dir });
        } catch (e) {
            code = e.code;
            assert.strictEqual(code, 'QUOTA_DEPLETED');
        }
        assert.ok(code, 'expected QUOTA_DEPLETED');
    } finally {
        if (prevPath !== undefined) process.env.AIGON_PROJECT_PATH = prevPath;
        else delete process.env.AIGON_PROJECT_PATH;
    }
}));

test('appendQuotaPausedDashboardActions emits quota Resume and Skip (F446 dashboard validActions)', () => withTempDir((dir) => {
    const merged = appendQuotaPausedDashboardActions(dir, 'feature', '9', {
        agents: { gg: { modelOverride: { model: 'gemini-pro' }, status: 'running' } },
    }, [{
        id: 'gg',
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
