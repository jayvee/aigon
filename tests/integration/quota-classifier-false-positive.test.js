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
const { test, testAsync, withTempDir, withTempDirAsync, report } = require('../_helpers');

const quotaProbe = require('../../lib/quota-probe');
const agentRegistry = require('../../lib/agent-registry');
const quotaMidRun = require('../../lib/quota-mid-run-detector');
const { sanitisePaneSample, postPauseAliveCounts, emittedDedupe, lastActivityByName } = quotaMidRun;
const workflowEngine = require('../../lib/workflow-core');

// --- Regex-level false-positive tests ---

const FALSE_POSITIVE_STRINGS = [
    '429 +',
    '429 +                                // some comment',
    'v4.29.0',
    '4290',
    '429K',
    's429abc',
    '429.test.js',
    '"id": "anthropic-rate-limit"',
    'id: anthropic-rate-limit',
];

const TRUE_POSITIVE_STRINGS = [
    'HTTP 429',
    'HTTP/1.1 429',
    'status 429',
    'status: 429',
    'code 429',
    'error: 429',
    'Error 429',
    '429 Too Many Requests',
    '429 too many requests',
    'rate-limit exceeded',
    'rate limited',
    'rate_limit',
    'You\'ve hit your limit',
    "you've hit your limit",
    'Too many requests',
    'too_many_requests',
];

test('cc.json tightened regex: must NOT match false-positive strings', () => {
    const cc = agentRegistry.getAgent('cc');
    assert.ok(cc, 'cc agent registered');
    for (const s of FALSE_POSITIVE_STRINGS) {
        const result = quotaProbe.classifyProbeResult(cc, { ok: false, stdout: s });
        assert.notStrictEqual(
            result.verdict, 'depleted',
            `cc false positive: "${s}" classified as depleted (patternId: ${result.matchedPatternId})`,
        );
    }
});

test('cc.json tightened regex: must STILL match true-positive strings', () => {
    const cc = agentRegistry.getAgent('cc');
    for (const s of TRUE_POSITIVE_STRINGS) {
        const result = quotaProbe.classifyProbeResult(cc, { ok: false, stdout: s });
        assert.strictEqual(
            result.verdict, 'depleted',
            `cc missed genuine rate limit: "${s}" (verdict: ${result.verdict})`,
        );
    }
});

test('gg.json tightened regex: must NOT match false-positive strings', () => {
    const gg = agentRegistry.getAgent('gg');
    assert.ok(gg, 'gg agent registered');
    const ggFalsePositives = FALSE_POSITIVE_STRINGS.filter(s => s !== '"id": "anthropic-rate-limit"');
    for (const s of ggFalsePositives) {
        const result = quotaProbe.classifyProbeResult(gg, { ok: false, stdout: s });
        assert.notStrictEqual(
            result.verdict, 'depleted',
            `gg false positive: "${s}" classified as depleted`,
        );
    }
});

test('gg.json tightened regex: must STILL match true-positive strings', () => {
    const gg = agentRegistry.getAgent('gg');
    // gg has RESOURCE_EXHAUSTED + 429/rate-limit patterns; excludes Anthropic-specific phrases
    const ggTruePositives = TRUE_POSITIVE_STRINGS.filter(
        s => !["You've hit your limit", "you've hit your limit"].includes(s),
    );
    for (const s of ggTruePositives) {
        const result = quotaProbe.classifyProbeResult(gg, { ok: false, stdout: s });
        assert.strictEqual(
            result.verdict, 'depleted',
            `gg missed genuine rate limit: "${s}" (verdict: ${result.verdict})`,
        );
    }
});

test('cx.json tightened regex: must NOT match false-positive strings', () => {
    const cx = agentRegistry.getAgent('cx');
    assert.ok(cx, 'cx agent registered');
    for (const s of FALSE_POSITIVE_STRINGS) {
        const result = quotaProbe.classifyProbeResult(cx, { ok: false, stdout: s });
        assert.notStrictEqual(
            result.verdict, 'depleted',
            `cx false positive: "${s}" classified as depleted`,
        );
    }
});

// --- Sanitiser tests ---

test('sanitisePaneSample strips lines with errorPatterns JSON key', () => {
    const cc = agentRegistry.getAgent('cc');
    const pane = `normal line\n  "errorPatterns": [\n    { "match": "rate.{0,3}limit" }\nnormal again`;
    const sanitised = sanitisePaneSample(pane, cc);
    assert.ok(!sanitised.includes('"errorPatterns"'), 'errorPatterns line should be stripped');
    assert.ok(sanitised.includes('normal line'), 'normal lines preserved');
    assert.ok(sanitised.includes('normal again'), 'normal lines preserved');
});

test('sanitisePaneSample strips lines containing the agent JSON file path', () => {
    const cc = agentRegistry.getAgent('cc');
    const pane = `reading file\ntemplates/agents/cc.json\nstill working`;
    const sanitised = sanitisePaneSample(pane, cc);
    assert.ok(!sanitised.includes('templates/agents/cc.json'), 'agent path line stripped');
    assert.ok(sanitised.includes('still working'), 'other lines preserved');
});

test('sanitisePaneSample strips lines containing the errorPattern match source', () => {
    const cc = agentRegistry.getAgent('cc');
    const matchSource = cc.quota.errorPatterns[0].match;
    const pane = `some output\n"match": "${matchSource}"\nmore output`;
    const sanitised = sanitisePaneSample(pane, cc);
    assert.ok(!sanitised.includes(matchSource), 'match-source line stripped');
    assert.ok(sanitised.includes('more output'), 'other lines preserved');
});

test('sanitised cc.json errorPatterns block does not classify as depleted', () => {
    const cc = agentRegistry.getAgent('cc');
    const ccJsonPath = path.join(__dirname, '..', '..', 'templates', 'agents', 'cc.json');
    const ccJsonContent = fs.readFileSync(ccJsonPath, 'utf8');
    const sanitised = sanitisePaneSample(ccJsonContent, cc);
    const result = quotaProbe.classifyProbeResult(cc, { ok: false, stdout: sanitised });
    assert.notStrictEqual(
        result.verdict, 'depleted',
        `cc.json content after sanitisation should not classify as depleted (got: ${result.verdict}, patternId: ${result.matchedPatternId})`,
    );
});

// --- Auto-clear (stale signal) tests ---

testAsync('auto-clear fires after MIN_SCANS alive ticks with elapsed time', async () => withTempDirAsync(async (dir) => {
    // Use unique IDs so concurrent test runs don't share map keys
    const runId = `ac${Date.now()}`;
    const entityId = `505ac${runId}`;
    const agentId = 'cc';
    const entityType = 'feature';
    const sessionName = `test-autofix-${runId}`;

    // Bootstrap workflow state
    const wfDir = path.join(dir, '.aigon', 'workflows', 'features', entityId);
    fs.mkdirSync(wfDir, { recursive: true });
    const snap = {
        featureId: entityId,
        currentSpecState: 'implementing',
        agents: { cc: { status: 'running', lastHeartbeatAt: new Date().toISOString() } },
        quotaSignals: [{
            kind: 'paused',
            agentId,
            role: 'do',
            patternId: 'anthropic-rate-limit',
            resetAt: null,
            detectedAt: new Date(Date.now() - 90_000).toISOString(),
            paneSampleHash: 'abc123',
            sessionName,
        }],
    };
    fs.writeFileSync(path.join(wfDir, 'snapshot.json'), JSON.stringify(snap));

    // Bootstrap events log
    fs.mkdirSync(path.join(wfDir, 'events'), { recursive: true });
    fs.writeFileSync(path.join(wfDir, 'events', '001.jsonl'), JSON.stringify({
        type: 'feature.agent_quota_paused',
        agentId,
        role: 'do',
        sessionName,
        patternId: 'anthropic-rate-limit',
        resetAt: null,
        detectedAt: snap.quotaSignals[0].detectedAt,
        at: snap.quotaSignals[0].detectedAt,
    }) + '\n');

    // Bootstrap agent status (quota-paused, paused 90 seconds ago)
    const stateDir = path.join(dir, '.aigon', 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    const pausedAt = new Date(Date.now() - 90_000).toISOString();
    fs.writeFileSync(path.join(stateDir, `feature-${entityId}-${agentId}.json`), JSON.stringify({
        agent: agentId,
        status: 'quota-paused',
        priorQuotaStatus: 'implementing',
        quotaPausedAt: pausedAt,
        quotaPauseMeta: { patternId: 'anthropic-rate-limit', resetAt: null, sessionName },
        updatedAt: pausedAt,
    }));

    // Bootstrap sidecar session
    const sessionsDir = path.join(dir, '.aigon', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, `${sessionName}.json`), JSON.stringify({
        sessionName,
        agent: agentId,
        entityType: 'f',
        entityId,
        role: 'do',
        tmuxId: null,
    }));

    const epoch1 = Date.now();
    const epoch2 = epoch1 + 1;
    const activityMap1 = new Map([[sessionName, epoch1]]);
    const activityMap2 = new Map([[sessionName, epoch2]]);

    const stubDeps = {
        listSessionActivities: (() => {
            let call = 0;
            return () => (call++ === 0 ? activityMap1 : activityMap2);
        })(),
        tmuxSessionExists: () => true,
        capturePaneText: () => 'still working fine',
        persistQuotaPause: () => false,
        logger: () => {},
    };

    // Scan 1 and scan 2 — both see new activity epochs; second scan should trigger auto-clear
    await quotaMidRun.scanActiveSessions(dir, stubDeps);
    await quotaMidRun.scanActiveSessions(dir, stubDeps);

    // Give the async clear a tick to complete
    await new Promise(r => setTimeout(r, 100));

    // Counter should be cleared after firing
    assert.strictEqual(
        postPauseAliveCounts.get(`${entityType}:${entityId}:${agentId}`),
        undefined,
        'counter should be cleared after auto-clear fires',
    );

    // Agent status should be restored to priorQuotaStatus
    const agentStatusMod = require('../../lib/agent-status');
    const statusAfter = agentStatusMod.readAgentStatus(entityId, agentId, 'feature', { mainRepoPath: dir });
    assert.strictEqual(statusAfter && statusAfter.status, 'implementing', 'agent status restored to implementing');
}));

testAsync('auto-clear does NOT fire when paused agent has no new tmux activity (real rate limit)', async () => withTempDirAsync(async (dir) => {
    const runId = `gp${Date.now()}`;
    const entityId = `505gp${runId}`;
    const agentId = 'cc';
    const sessionName = `test-genuinely-paused-${runId}`;

    const sessionsDir = path.join(dir, '.aigon', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, `${sessionName}.json`), JSON.stringify({
        sessionName,
        agent: agentId,
        entityType: 'f',
        entityId,
        role: 'do',
    }));

    const stateDir = path.join(dir, '.aigon', 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    const pausedAt = new Date(Date.now() - 90_000).toISOString();
    fs.writeFileSync(path.join(stateDir, `feature-${entityId}-${agentId}.json`), JSON.stringify({
        agent: agentId,
        status: 'quota-paused',
        priorQuotaStatus: 'implementing',
        quotaPausedAt: pausedAt,
        quotaPauseMeta: { patternId: 'anthropic-rate-limit', sessionName },
        updatedAt: pausedAt,
    }));

    const wfDir = path.join(dir, '.aigon', 'workflows', 'features', entityId);
    fs.mkdirSync(wfDir, { recursive: true });
    fs.writeFileSync(path.join(wfDir, 'snapshot.json'), JSON.stringify({
        featureId: entityId,
        currentSpecState: 'implementing',
        agents: { cc: { status: 'quota-paused' } },
        quotaSignals: [{
            kind: 'paused', agentId, role: 'do',
            patternId: 'anthropic-rate-limit', resetAt: null,
            detectedAt: pausedAt, sessionName,
        }],
    }));
    fs.mkdirSync(path.join(wfDir, 'events'), { recursive: true });
    fs.writeFileSync(path.join(wfDir, 'events', '001.jsonl'), '');

    // Stable epoch — session exists but no new activity (agent is genuinely stuck)
    const stableEpoch = 9999999;
    const activityMap = new Map([[sessionName, stableEpoch]]);
    lastActivityByName.set(sessionName, stableEpoch); // pre-cache the same epoch

    const stubDeps = {
        listSessionActivities: () => activityMap,
        tmuxSessionExists: () => true,
        capturePaneText: () => { throw new Error('should not capture pane for frozen session'); },
        persistQuotaPause: () => false,
        logger: () => {},
    };

    // Multiple scans — F454 gating skips the session because epoch is unchanged
    await quotaMidRun.scanActiveSessions(dir, stubDeps);
    await quotaMidRun.scanActiveSessions(dir, stubDeps);
    await quotaMidRun.scanActiveSessions(dir, stubDeps);

    const count = postPauseAliveCounts.get(`feature:${entityId}:${agentId}`) || 0;
    assert.strictEqual(count, 0, 'no alive-scan counts for frozen session — F454 gating prevents entry');
}));

report();
