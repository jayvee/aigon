#!/usr/bin/env node
'use strict';
const a = require('assert');
const { test, testAsync, withTempDirAsync, report } = require('../_helpers');
const fo = require('../../lib/agent-failover');
const wf = require('../../lib/workflow-core');
const { writeAgentStatusAt, readAgentStatusRecordAt } = require('../../lib/agent-status');
const { projectContext } = require('../../lib/workflow-core/projector');
const { FEATURE_ACTION_CANDIDATES } = require('../../lib/feature-workflow-rules');

const sig = (overrides = {}) => fo.buildTokenExhaustionSignal({
    slotAgentId: 'cc',
    agentState: { currentAgentId: 'cc' },
    statusRecord: { lastExitCode: 0, lastPaneTail: '' },
    featureId: '42',
    repoPath: '/tmp/none',
    failoverConfig: { policy: 'notify', chain: ['cc', 'cx'], tokenLimits: { perSessionBillableTokens: null } },
    ...overrides,
});

// Detection: positive-signal requirement — AC "no false positives".
test('buildTokenExhaustionSignal: no signal on clean exit', () => a.strictEqual(sig(), null));
test('buildTokenExhaustionSignal: fires on stderr pattern match', () => {
    const s = sig({ statusRecord: { lastExitCode: 1, lastPaneTail: 'Error: usage limit reached.' } });
    a.ok(s); a.strictEqual(s.source, 'stderr_pattern');
});
test('buildTokenExhaustionSignal: generic non-zero exit stays a normal failure', () =>
    a.strictEqual(sig({ statusRecord: { lastExitCode: 127, lastPaneTail: 'command not found: npx' } }), null));
test('buildTokenExhaustionSignal: listed exit code without exhaustion stderr is ignored', () =>
    a.strictEqual(sig({ statusRecord: { lastExitCode: 1, lastPaneTail: 'build failed' } }), null));

// REGRESSION: dashboard manual switch must clear the same status flags as auto-switch or supervisor never re-detects exhaustion for that slot.
testAsync('clearTokenExhaustedFlag: clears supervisor flags so a slot can exhaust again', () => withTempDirAsync(async (repo) => {
    await wf.startFeature(repo, '79', 'solo_worktree', ['cx'], { agentFailover: { chain: ['cx', 'cc'] } });
    writeAgentStatusAt(repo, '79', 'cx', {
        status: 'needs_attention',
        worktreePath: '/tmp/wt',
        runtimeAgentId: 'cx',
        lastExitCode: 1,
        lastPaneTail: 'usage limit',
        flags: { tokenExhausted: true, tokenExhaustedAt: 't1', tokenExhaustedSource: 'telemetry_limit' },
    }, 'feature');
    fo.clearTokenExhaustedFlag(repo, '79', 'cx', 'cc', '/tmp/wt');
    const r = readAgentStatusRecordAt(repo, '79', 'cx', { prefixes: ['feature'] });
    a.strictEqual(r.data.status, 'implementing');
    a.strictEqual(r.data.runtimeAgentId, 'cc');
    a.strictEqual(r.data.lastExitCode, null);
    a.ok(!r.data.flags || !Object.prototype.hasOwnProperty.call(r.data.flags, 'tokenExhausted'));
}));

// Chain selection.
test('chooseNextAgent: picks next entry, honours excludes, null when exhausted', () => {
    a.strictEqual(fo.chooseNextAgent(['cx', 'cc', 'gg'], 'cx', ['cx']), 'cc');
    a.strictEqual(fo.chooseNextAgent(['cx', 'cc', 'gg'], 'cx', ['cx', 'cc']), 'gg');
    a.strictEqual(fo.chooseNextAgent(['cx', 'cc'], 'cc', ['cc']), null);
    a.strictEqual(fo.chooseNextAgent([], 'cc', ['cc']), null);
});

// Snapshot carries chain + token_exhausted + failover_switched projection.
testAsync('startFeature persists agentFailover chain on the snapshot', () => withTempDirAsync(async (repo) => {
    await wf.startFeature(repo, '77', 'solo_worktree', ['cx'], { agentFailover: { chain: ['cx', 'cc'] } });
    a.deepStrictEqual((await wf.showFeatureOrNull(repo, '77')).agentFailover, { chain: ['cx', 'cc'] });
}));

testAsync('token_exhausted + failover_switched: projector records attribution and clears exhausted flag', () => withTempDirAsync(async (repo) => {
    await wf.startFeature(repo, '78', 'solo_worktree', ['cx'], { agentFailover: { chain: ['cx', 'cc'] } });
    await wf.recordAgentTokenExhausted(repo, '78', { agentId: 'cx', source: 'telemetry_limit', currentAgentId: 'cx', tokensConsumed: 200000, limit: 150000 });
    let snap = await wf.showFeatureOrNull(repo, '78');
    a.strictEqual(snap.agents.cx.status, 'needs_attention');
    a.strictEqual(snap.agents.cx.tokenExhausted.source, 'telemetry_limit');
    await wf.recordAgentFailoverSwitch(repo, '78', { agentId: 'cx', previousAgentId: 'cx', replacementAgentId: 'cc', source: 'telemetry_limit', lastCommit: 'abc1234' });
    snap = await wf.showFeatureOrNull(repo, '78');
    a.strictEqual(snap.agents.cx.status, 'running');
    a.strictEqual(snap.agents.cx.currentAgentId, 'cc');
    a.strictEqual(snap.agents.cx.resumedFromAgentId, 'cx');
    a.strictEqual(snap.agents.cx.tokenExhausted, null);
}));

// Dashboard action eligibility: SWITCH_AGENT guard is what gates the dashboard button.
test('SWITCH_AGENT guard requires tokenExhausted AND a non-empty successor chain', () => {
    const cand = FEATURE_ACTION_CANDIDATES.find(c => c.kind === 'switch-agent');
    const ctx = (chain, ex) => ({ agentFailover: { chain }, agents: { cx: { tokenExhausted: ex ? {} : null, currentAgentId: 'cx' } } });
    const agent = (ex) => ({ tokenExhausted: ex ? { source: 's' } : null, currentAgentId: 'cx' });
    a.strictEqual(cand.guard({ agent: agent(true), agentId: 'cx', context: ctx([], true) }), false);
    a.strictEqual(cand.guard({ agent: agent(false), agentId: 'cx', context: ctx(['cx', 'cc'], false) }), false);
    a.strictEqual(cand.guard({ agent: agent(true), agentId: 'cx', context: ctx(['cx', 'cc'], true) }), true);
});

// Projector replay: snapshot is the authoritative source of truth.
test('projector replays token_exhausted + failover_switched in order', () => {
    const ctx = projectContext([
        { type: 'feature.started', featureId: '80', mode: 'solo_worktree', agents: ['cx'], agentFailover: { chain: ['cx', 'cc'] }, at: '2026-04-22T10:00:00Z' },
        { type: 'agent.token_exhausted', agentId: 'cx', source: 'exit_code', currentAgentId: 'cx', at: '2026-04-22T10:05:00Z' },
        { type: 'agent.failover_switched', agentId: 'cx', previousAgentId: 'cx', replacementAgentId: 'cc', at: '2026-04-22T10:06:00Z' },
    ]);
    a.strictEqual(ctx.agents.cx.status, 'running');
    a.strictEqual(ctx.agents.cx.currentAgentId, 'cc');
    a.strictEqual(ctx.agents.cx.tokenExhausted, null);
});

report();
