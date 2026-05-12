#!/usr/bin/env node
'use strict';

/**
 * F505: Regression tests for quota classifier false positives.
 * Verifies that bare `429` in diff hunks, version strings, etc. does not trigger
 * the quota detector, while genuine HTTP 429 errors still do.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, testAsync, withTempDirAsync, report } = require('../_helpers');

const quotaProbe = require('../../lib/quota-probe');
const agentRegistry = require('../../lib/agent-registry');
const quotaMidRun = require('../../lib/quota-mid-run-detector');
const { sanitisePaneSample, postPauseAliveCounts, lastActivityByName } = quotaMidRun;

// --- Regex-level false-positive guards (table-driven per agent) ---

const FALSE_POSITIVE = [
    '429 +', '429 +                                // some comment',
    'v4.29.0', '4290', '429K', 's429abc', '429.test.js',
    '"id": "anthropic-rate-limit"', 'id: anthropic-rate-limit',
];
const TRUE_POSITIVE = [
    'HTTP 429', 'HTTP/1.1 429', 'status 429', 'status: 429', 'code 429',
    'error: 429', 'Error 429', '429 Too Many Requests', '429 too many requests',
    'rate-limit exceeded', 'rate limited', 'rate_limit',
    "You've hit your limit", "you've hit your limit",
    'Too many requests', 'too_many_requests',
];

// Per-agent exclusions: strings the agent intentionally does NOT match.
const AGENTS = [
    { id: 'cc', excludeFP: [],                                       excludeTP: [] },
    { id: 'gg', excludeFP: ['"id": "anthropic-rate-limit"'],         excludeTP: ["You've hit your limit", "you've hit your limit"] },
    { id: 'cx', excludeFP: [],                                       excludeTP: TRUE_POSITIVE /* cx not tested for true-positives in original */ },
];

for (const { id, excludeFP, excludeTP } of AGENTS) {
    test(`${id}.json regex: false-positive strings must NOT classify as depleted`, () => {
        const agent = agentRegistry.getAgent(id);
        assert.ok(agent, `${id} agent registered`);
        for (const s of FALSE_POSITIVE) {
            if (excludeFP.includes(s)) continue;
            const result = quotaProbe.classifyProbeResult(agent, { ok: false, stdout: s });
            assert.notStrictEqual(result.verdict, 'depleted',
                `${id} false positive: "${s}" classified as depleted (patternId: ${result.matchedPatternId})`);
        }
    });

    if (excludeTP.length === TRUE_POSITIVE.length) continue; // agent not asserted for TP

    test(`${id}.json regex: true-positive strings must STILL match`, () => {
        const agent = agentRegistry.getAgent(id);
        for (const s of TRUE_POSITIVE) {
            if (excludeTP.includes(s)) continue;
            const result = quotaProbe.classifyProbeResult(agent, { ok: false, stdout: s });
            assert.strictEqual(result.verdict, 'depleted',
                `${id} missed genuine rate limit: "${s}" (verdict: ${result.verdict})`);
        }
    });
}

// --- Sanitiser tests ---

test('sanitisePaneSample strips errorPatterns / agent-json-path / match-source lines', () => {
    const cc = agentRegistry.getAgent('cc');
    const matchSource = cc.quota.errorPatterns[0].match;
    const pane = [
        'normal line',
        '  "errorPatterns": [',
        '    { "match": "rate.{0,3}limit" }',
        'reading file',
        'templates/agents/cc.json',
        `"match": "${matchSource}"`,
        'normal again',
    ].join('\n');
    const sanitised = sanitisePaneSample(pane, cc);
    assert.ok(!sanitised.includes('"errorPatterns"'), 'errorPatterns line should be stripped');
    assert.ok(!sanitised.includes('templates/agents/cc.json'), 'agent path line stripped');
    assert.ok(!sanitised.includes(matchSource), 'match-source line stripped');
    assert.ok(sanitised.includes('normal line') && sanitised.includes('normal again'),
        'normal lines preserved');
});

test('sanitised cc.json errorPatterns block does not classify as depleted', () => {
    const cc = agentRegistry.getAgent('cc');
    const ccJsonPath = path.join(__dirname, '..', '..', 'templates', 'agents', 'cc.json');
    const ccJsonContent = fs.readFileSync(ccJsonPath, 'utf8');
    const sanitised = sanitisePaneSample(ccJsonContent, cc);
    const result = quotaProbe.classifyProbeResult(cc, { ok: false, stdout: sanitised });
    assert.notStrictEqual(result.verdict, 'depleted',
        `cc.json content after sanitisation should not classify as depleted (got: ${result.verdict}, patternId: ${result.matchedPatternId})`);
});

// --- Auto-clear (stale signal) tests ---

testAsync('auto-clear fires after MIN_SCANS alive ticks with elapsed time', async () => withTempDirAsync(async (dir) => {
    const runId = `ac${Date.now()}`;
    const entityId = `505ac${runId}`;
    const agentId = 'cc';
    const sessionName = `test-autofix-${runId}`;

    const wfDir = path.join(dir, '.aigon', 'workflows', 'features', entityId);
    fs.mkdirSync(wfDir, { recursive: true });
    const detectedAt = new Date(Date.now() - 90_000).toISOString();
    fs.writeFileSync(path.join(wfDir, 'snapshot.json'), JSON.stringify({
        featureId: entityId,
        currentSpecState: 'implementing',
        agents: { cc: { status: 'running', lastHeartbeatAt: new Date().toISOString() } },
        quotaSignals: [{
            kind: 'paused', agentId, role: 'do',
            patternId: 'anthropic-rate-limit', resetAt: null,
            detectedAt, paneSampleHash: 'abc123', sessionName,
        }],
    }));
    fs.mkdirSync(path.join(wfDir, 'events'), { recursive: true });
    fs.writeFileSync(path.join(wfDir, 'events', '001.jsonl'), JSON.stringify({
        type: 'feature.agent_quota_paused',
        agentId, role: 'do', sessionName,
        patternId: 'anthropic-rate-limit', resetAt: null,
        detectedAt, at: detectedAt,
    }) + '\n');

    const stateDir = path.join(dir, '.aigon', 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, `feature-${entityId}-${agentId}.json`), JSON.stringify({
        agent: agentId, status: 'quota-paused', priorQuotaStatus: 'implementing',
        quotaPausedAt: detectedAt,
        quotaPauseMeta: { patternId: 'anthropic-rate-limit', resetAt: null, sessionName },
        updatedAt: detectedAt,
    }));

    const sessionsDir = path.join(dir, '.aigon', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, `${sessionName}.json`), JSON.stringify({
        sessionName, agent: agentId, entityType: 'f', entityId, role: 'do', tmuxId: null,
    }));

    const epoch1 = Date.now();
    const activityMap1 = new Map([[sessionName, epoch1]]);
    const activityMap2 = new Map([[sessionName, epoch1 + 1]]);
    const stubDeps = {
        listSessionActivities: (() => { let c = 0; return () => (c++ === 0 ? activityMap1 : activityMap2); })(),
        tmuxSessionExists: () => true,
        capturePaneText: () => 'still working fine',
        persistQuotaPause: () => false,
        logger: () => {},
    };

    await quotaMidRun.scanActiveSessions(dir, stubDeps);
    await quotaMidRun.scanActiveSessions(dir, stubDeps);
    await new Promise(r => setTimeout(r, 100));

    assert.strictEqual(postPauseAliveCounts.get(`feature:${entityId}:${agentId}`), undefined,
        'counter should be cleared after auto-clear fires');
    const statusAfter = require('../../lib/agent-status').readAgentStatus(entityId, agentId, 'feature', { mainRepoPath: dir });
    assert.strictEqual(statusAfter && statusAfter.status, 'implementing', 'agent status restored');
}));

testAsync('auto-clear does NOT fire when paused agent has no new tmux activity (real rate limit)', async () => withTempDirAsync(async (dir) => {
    const runId = `gp${Date.now()}`;
    const entityId = `505gp${runId}`;
    const agentId = 'cc';
    const sessionName = `test-genuinely-paused-${runId}`;

    const sessionsDir = path.join(dir, '.aigon', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, `${sessionName}.json`), JSON.stringify({
        sessionName, agent: agentId, entityType: 'f', entityId, role: 'do',
    }));

    const stateDir = path.join(dir, '.aigon', 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    const pausedAt = new Date(Date.now() - 90_000).toISOString();
    fs.writeFileSync(path.join(stateDir, `feature-${entityId}-${agentId}.json`), JSON.stringify({
        agent: agentId, status: 'quota-paused', priorQuotaStatus: 'implementing',
        quotaPausedAt: pausedAt,
        quotaPauseMeta: { patternId: 'anthropic-rate-limit', sessionName },
        updatedAt: pausedAt,
    }));

    const wfDir = path.join(dir, '.aigon', 'workflows', 'features', entityId);
    fs.mkdirSync(wfDir, { recursive: true });
    fs.writeFileSync(path.join(wfDir, 'snapshot.json'), JSON.stringify({
        featureId: entityId, currentSpecState: 'implementing',
        agents: { cc: { status: 'quota-paused' } },
        quotaSignals: [{
            kind: 'paused', agentId, role: 'do',
            patternId: 'anthropic-rate-limit', resetAt: null,
            detectedAt: pausedAt, sessionName,
        }],
    }));
    fs.mkdirSync(path.join(wfDir, 'events'), { recursive: true });
    fs.writeFileSync(path.join(wfDir, 'events', '001.jsonl'), '');

    const stableEpoch = 9999999;
    lastActivityByName.set(sessionName, stableEpoch);
    const stubDeps = {
        listSessionActivities: () => new Map([[sessionName, stableEpoch]]),
        tmuxSessionExists: () => true,
        capturePaneText: () => { throw new Error('should not capture pane for frozen session'); },
        persistQuotaPause: () => false,
        logger: () => {},
    };

    await quotaMidRun.scanActiveSessions(dir, stubDeps);
    await quotaMidRun.scanActiveSessions(dir, stubDeps);
    await quotaMidRun.scanActiveSessions(dir, stubDeps);

    assert.strictEqual(postPauseAliveCounts.get(`feature:${entityId}:${agentId}`) || 0, 0,
        'no alive-scan counts for frozen session — F454 gating prevents entry');
}));

report();
