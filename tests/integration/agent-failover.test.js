#!/usr/bin/env node
'use strict';

const a = require('assert');
const { test, testAsync, withTempDir, withTempDirAsync, report } = require('../_helpers');

const failover = require('../../lib/agent-failover');
const wf = require('../../lib/workflow-core');
const { projectContext } = require('../../lib/workflow-core/projector');

// -----------------------------------------------------------------------------
// Detection: positive-signal requirement (AC "no false positives")
// -----------------------------------------------------------------------------

test('buildTokenExhaustionSignal: returns null when no detector matches', () => {
    const signal = failover.buildTokenExhaustionSignal({
        slotAgentId: 'cc',
        agentState: { currentAgentId: 'cc' },
        statusRecord: { lastExitCode: 0, lastPaneTail: 'all good' },
        featureId: '42',
        repoPath: '/tmp/doesnotexist',
        failoverConfig: { policy: 'notify', chain: ['cc', 'cx'], tokenLimits: { perSessionBillableTokens: null } },
    });
    a.strictEqual(signal, null, 'no signal on clean exit');
});

test('buildTokenExhaustionSignal: fires on stderr pattern match', () => {
    const signal = failover.buildTokenExhaustionSignal({
        slotAgentId: 'cc',
        agentState: { currentAgentId: 'cc' },
        statusRecord: { lastExitCode: 1, lastPaneTail: 'Error: usage limit reached. Please try again later.' },
        featureId: '42',
        repoPath: '/tmp/doesnotexist',
        failoverConfig: { policy: 'notify', chain: ['cc', 'cx'], tokenLimits: { perSessionBillableTokens: null } },
    });
    a.ok(signal, 'expected signal');
    a.strictEqual(signal.source, 'stderr_pattern');
    a.strictEqual(signal.currentAgentId, 'cc');
});

test('buildTokenExhaustionSignal: ignores unrelated non-zero exit without matching pattern', () => {
    const signal = failover.buildTokenExhaustionSignal({
        slotAgentId: 'cc',
        agentState: { currentAgentId: 'cc' },
        statusRecord: { lastExitCode: 127, lastPaneTail: 'command not found: npx' },
        featureId: '42',
        repoPath: '/tmp/doesnotexist',
        failoverConfig: { policy: 'notify', chain: ['cc', 'cx'], tokenLimits: { perSessionBillableTokens: null } },
    });
    a.strictEqual(signal, null, 'generic non-zero exit is not an exhaustion signal');
});

// -----------------------------------------------------------------------------
// Chain selection
// -----------------------------------------------------------------------------

test('chooseNextAgent: picks next entry after current', () => {
    a.strictEqual(failover.chooseNextAgent(['cx', 'cc', 'gg'], 'cx', ['cx']), 'cc');
});

test('chooseNextAgent: respects excluded set even if chain is longer', () => {
    a.strictEqual(failover.chooseNextAgent(['cx', 'cc', 'gg'], 'cx', ['cx', 'cc']), 'gg');
});

test('chooseNextAgent: returns null when chain is exhausted', () => {
    a.strictEqual(failover.chooseNextAgent(['cx', 'cc'], 'cc', ['cc']), null);
});

test('chooseNextAgent: empty chain yields null', () => {
    a.strictEqual(failover.chooseNextAgent([], 'cc', ['cc']), null);
});

// -----------------------------------------------------------------------------
// Workflow events: agent.token_exhausted + agent.failover_switched projection
// -----------------------------------------------------------------------------

testAsync('startFeature persists agentFailover chain on the workflow snapshot', () => withTempDirAsync(async (repo) => {
    await wf.startFeature(repo, '77', 'solo_worktree', ['cx'], {
        agentFailover: { chain: ['cx', 'cc'] },
    });
    const snap = await wf.showFeatureOrNull(repo, '77');
    a.ok(snap, 'snapshot exists');
    a.deepStrictEqual(snap.agentFailover, { chain: ['cx', 'cc'] });
}));

testAsync('token_exhausted projects needs_attention + tokenExhausted payload on the agent', () => withTempDirAsync(async (repo) => {
    await wf.startFeature(repo, '78', 'solo_worktree', ['cx'], {
        agentFailover: { chain: ['cx', 'cc'] },
    });
    await wf.recordAgentTokenExhausted(repo, '78', {
        agentId: 'cx',
        role: 'do',
        lastCommit: 'abc1234',
        tokensConsumed: 200000,
        limit: 150000,
        source: 'telemetry_limit',
        currentAgentId: 'cx',
    });
    const snap = await wf.showFeatureOrNull(repo, '78');
    a.strictEqual(snap.agents.cx.status, 'needs_attention');
    a.ok(snap.agents.cx.tokenExhausted, 'tokenExhausted payload on snapshot');
    a.strictEqual(snap.agents.cx.tokenExhausted.source, 'telemetry_limit');
    a.strictEqual(snap.agents.cx.tokenExhausted.tokensConsumed, 200000);
}));

testAsync('failover_switched records attribution on agent state', () => withTempDirAsync(async (repo) => {
    await wf.startFeature(repo, '79', 'solo_worktree', ['cx'], {
        agentFailover: { chain: ['cx', 'cc'] },
    });
    await wf.recordAgentTokenExhausted(repo, '79', { agentId: 'cx', source: 'stderr_pattern', currentAgentId: 'cx' });
    await wf.recordAgentFailoverSwitch(repo, '79', {
        agentId: 'cx',
        previousAgentId: 'cx',
        replacementAgentId: 'cc',
        source: 'stderr_pattern',
        lastCommit: 'abc1234',
    });
    const snap = await wf.showFeatureOrNull(repo, '79');
    a.strictEqual(snap.agents.cx.status, 'running', 'slot returns to running after switch');
    a.strictEqual(snap.agents.cx.currentAgentId, 'cc', 'currentAgentId records replacement');
    a.strictEqual(snap.agents.cx.resumedFromAgentId, 'cx', 'resumedFromAgentId records predecessor');
    a.strictEqual(snap.agents.cx.tokenExhausted, null, 'tokenExhausted cleared on switch');
}));

// -----------------------------------------------------------------------------
// Dashboard action eligibility: SWITCH_AGENT is only offered when exhausted + chain exists
// -----------------------------------------------------------------------------

test('feature-workflow-rules: SWITCH_AGENT guard demands tokenExhausted AND non-empty chain', () => {
    const { FEATURE_ACTION_CANDIDATES } = require('../../lib/feature-workflow-rules');
    const switchCandidate = FEATURE_ACTION_CANDIDATES.find(c => c.kind === 'switch-agent');
    a.ok(switchCandidate, 'SWITCH_AGENT candidate registered');

    // No chain — guard should fail.
    const gated = switchCandidate.guard({
        agent: { tokenExhausted: { source: 'stderr_pattern' }, currentAgentId: 'cx' },
        agentId: 'cx',
        context: { agentFailover: { chain: [] }, agents: { cx: { tokenExhausted: {}, currentAgentId: 'cx' } } },
    });
    a.strictEqual(gated, false, 'guard rejects empty chain');

    // Not exhausted — guard should fail.
    const notExhausted = switchCandidate.guard({
        agent: { tokenExhausted: null, currentAgentId: 'cx' },
        agentId: 'cx',
        context: { agentFailover: { chain: ['cx', 'cc'] }, agents: { cx: { currentAgentId: 'cx' } } },
    });
    a.strictEqual(notExhausted, false, 'guard rejects healthy agent');

    // Exhausted + chain has a successor — guard should succeed.
    const eligible = switchCandidate.guard({
        agent: { tokenExhausted: { source: 'stderr_pattern' }, currentAgentId: 'cx' },
        agentId: 'cx',
        context: { agentFailover: { chain: ['cx', 'cc'] }, agents: { cx: { tokenExhausted: {}, currentAgentId: 'cx' } } },
    });
    a.strictEqual(eligible, true, 'guard allows exhausted slot with chain successor');
});

// -----------------------------------------------------------------------------
// Projector replay — ensure the snapshot is the authoritative source
// -----------------------------------------------------------------------------

test('projector replays token_exhausted + failover_switched events in order', () => {
    const events = [
        { type: 'feature.started', featureId: '80', mode: 'solo_worktree', agents: ['cx'], agentFailover: { chain: ['cx', 'cc'] }, at: '2026-04-22T10:00:00Z' },
        { type: 'agent.token_exhausted', agentId: 'cx', source: 'exit_code', currentAgentId: 'cx', at: '2026-04-22T10:05:00Z' },
        { type: 'agent.failover_switched', agentId: 'cx', previousAgentId: 'cx', replacementAgentId: 'cc', at: '2026-04-22T10:06:00Z' },
    ];
    const context = projectContext(events);
    a.ok(context, 'projector produced a context');
    a.strictEqual(context.agents.cx.status, 'running');
    a.strictEqual(context.agents.cx.currentAgentId, 'cc');
    a.strictEqual(context.agents.cx.resumedFromAgentId, 'cx');
    a.strictEqual(context.agents.cx.tokenExhausted, null);
});

report();
