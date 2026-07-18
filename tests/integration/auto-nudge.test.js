#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { test, testAsync, withTempDir, withTempDirAsync, report } = require('../_helpers');
const autoNudge = require('../../lib/auto-nudge');
const signalHealth = require('../../lib/signal-health');

function baseInput(sessionName = 'repo-f01-do-cx-demo') {
    return {
        entityType: 'feature',
        entityId: '01',
        agentId: 'cx',
        role: 'do',
        status: 'implementing',
        updatedAt: '2026-04-29T00:00:00.000Z',
        tmuxRunning: true,
        sessionName,
        idleAtPrompt: true,
        idleAtPromptDetectedAt: '2026-04-29T00:00:00.000Z',
    };
}

testAsync('auto-nudge idle ladder: T1 chip, one T2 nudge, T3 escalation', () => withTempDirAsync('aigon-auto-nudge-', async (repo) => {
    autoNudge._resetForTests();
    let nudges = 0;
    const deps = {
        loadProjectConfig: () => ({ autoNudge: { enabled: true, idleVisibleSec: 1, idleAutoNudgeSec: 2, idleEscalateSec: 3 } }),
        sendNudge: async () => { nudges += 1; return { ok: true }; },
    };

    assert.strictEqual(autoNudge.computeIdleLadder(repo, baseInput(), { ...deps, nowMs: Date.parse('2026-04-29T00:00:00.500Z') }).state, 'active');
    assert.strictEqual(autoNudge.computeIdleLadder(repo, baseInput(), { ...deps, nowMs: Date.parse('2026-04-29T00:00:01.100Z') }).state, 'idle-visible');
    assert.strictEqual(autoNudge.computeIdleLadder(repo, baseInput(), { ...deps, nowMs: Date.parse('2026-04-29T00:00:02.100Z') }).state, 'idle-nudged');
    assert.strictEqual(autoNudge.computeIdleLadder(repo, baseInput(), { ...deps, nowMs: Date.parse('2026-04-29T00:00:02.500Z') }).state, 'idle-nudged');
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(nudges, 1);
    assert.strictEqual(autoNudge.computeIdleLadder(repo, baseInput(), { ...deps, nowMs: Date.parse('2026-04-29T00:00:03.100Z') }).state, 'needs-attention');

    const events = signalHealth.readSignalEvents({ repoPath: repo, since: '2000-01-01', agent: 'cx' });
    assert.strictEqual(events.filter(e => e.kind === 'signal-emitted' && e.source === 'auto-nudge-idle-visible').length, 1);
    assert.strictEqual(events.filter(e => e.kind === 'signal-abandoned' && e.source === 'auto-nudge-escalated').length, 1);
}));

testAsync('auto-nudge resets nudged flag on dispatch failure so the next sweep can retry', () => withTempDirAsync('aigon-auto-nudge-retry-', async (repo) => {
    // Intentionally do NOT call _resetForTests() — this test runs concurrently with the
    // T1/T2/T3 test via testAsync, and clearing the shared sessionState mid-flight wipes
    // the sibling test's state. The temp-dir repoPath gives this test a unique session key.
    let calls = 0;
    const deps = {
        loadProjectConfig: () => ({ autoNudge: { enabled: true, idleVisibleSec: 1, idleAutoNudgeSec: 2, idleEscalateSec: 30 } }),
        sendNudge: async () => {
            calls += 1;
            if (calls === 1) throw new Error('Nudge text not found in pane after delivery');
            return { ok: true };
        },
    };

    const first = autoNudge.computeIdleLadder(repo, baseInput(), { ...deps, nowMs: Date.parse('2026-04-29T00:00:02.100Z') });
    assert.strictEqual(first.state, 'idle-nudged');
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(calls, 1);

    const second = autoNudge.computeIdleLadder(repo, baseInput(), { ...deps, nowMs: Date.parse('2026-04-29T00:00:02.500Z') });
    assert.strictEqual(second.state, 'idle-nudged', 'second sweep should re-dispatch after the first failed');
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(calls, 2);

    const events = signalHealth.readSignalEvents({ repoPath: repo, since: '2000-01-01', agent: 'cx' });
    assert.strictEqual(events.filter(e => e.kind === 'signal-abandoned' && e.source === 'auto-nudge-dispatch-failed').length, 1);
}));

test('auto-nudge is on by default, opt-out via enabled:false, and skips quota-paused agents', () => withTempDir('aigon-auto-nudge-default-', (repo) => {
    autoNudge._resetForTests();
    let nudges = 0;
    const deps = {
        loadProjectConfig: () => ({}),
        sendNudge: async () => { nudges += 1; return { ok: true }; },
        nowMs: Date.parse('2026-04-29T00:05:00.000Z'),
    };
    const onByDefault = autoNudge.computeIdleLadder(repo, baseInput(), deps);
    assert.strictEqual(onByDefault.state, 'needs-attention');
    assert.strictEqual(onByDefault.autoNudgeEnabled, true);

    autoNudge._resetForTests();
    const optedOut = autoNudge.computeIdleLadder(repo, baseInput(), {
        ...deps,
        loadProjectConfig: () => ({ autoNudge: { enabled: false } }),
    });
    assert.strictEqual(optedOut.autoNudgeEnabled, false);
    assert.strictEqual(nudges, 0);

    const quota = autoNudge.computeIdleLadder(repo, { ...baseInput(), status: 'quota-paused' }, {
        ...deps,
        loadProjectConfig: () => ({ autoNudge: { enabled: true, idleVisibleSec: 1, idleAutoNudgeSec: 2, idleEscalateSec: 3 } }),
    });
    assert.strictEqual(quota.state, 'active');
    assert.strictEqual(quota.skipped, 'quota-paused');
}));

testAsync('auto-nudge does not infer review-session idleness without an idle prompt signal', () => withTempDirAsync('aigon-auto-nudge-review-active-', async (repo) => {
    let nudges = 0;
    const deps = {
        loadProjectConfig: () => ({ autoNudge: { enabled: true, idleVisibleSec: 1, idleAutoNudgeSec: 2, idleEscalateSec: 3 } }),
        sendNudge: async () => { nudges += 1; return { ok: true }; },
    };

    const activeReview = {
        ...baseInput('repo-f01-review-cc-demo'),
        agentId: 'cc',
        role: 'review',
        status: 'reviewing',
        idleAtPrompt: false,
        idleAtPromptDetectedAt: '2026-04-29T00:00:00.000Z',
    };

    const result = autoNudge.computeIdleLadder(repo, activeReview, {
        ...deps,
        nowMs: Date.parse('2026-04-29T00:05:00.000Z'),
    });

    assert.strictEqual(result.state, 'active');
    assert.strictEqual(result.idleSec, 0);
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(nudges, 0);
}));

report();
