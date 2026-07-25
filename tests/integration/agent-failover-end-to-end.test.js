#!/usr/bin/env node
'use strict';

const a = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { test, testAsync, withTempDirAsync, report, withIsolatedTmuxAsync } = require('../_helpers');
const wf = require('../../lib/workflow-core');
const { writeAgentStatusAt } = require('../../lib/agent-status');
const { sweepEntity, tmuxSessionAlive } = require('../../lib/supervisor');
const agentFailover = require('../../lib/agent-failover');
const { buildTmuxSessionName, createDetachedTmuxSession } = require('../../lib/worktree');
const { _resetTmuxListCache } = require('../../lib/dashboard-status-helpers');

const killSession = (name) => {
    try { spawnSync('tmux', ['kill-session', '-t', name], { stdio: 'ignore' }); } catch (_) {}
};

function readEvents(repo, featureId) {
    const p = path.join(repo, '.aigon', 'workflows', 'features', featureId, 'events.jsonl');
    try {
        return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    } catch (_) {
        return [];
    }
}

// F693 merged aigon-pro into OSS: lib/agent-failover.js is the real handler the
// supervisor now calls directly, so these scenarios exercise the shipped engine
// rather than a stand-in. This file also absorbs the appendFailoverDashboardActions
// coverage that used to live in the aigon-pro copy of this test.
testAsync('agent-failover-end-to-end: all scenarios', async () => withIsolatedTmuxAsync(async () => {
    process.env.AIGON_TEST_MODE = '1';

    // -----------------------------------------------------------------------
    // Scenario 1: switch policy — cc exhausted, cx is next
    // -----------------------------------------------------------------------
    await withTempDirAsync(async (repo) => {
        const featureId = '1';
        const repoName = path.basename(repo);
        const sessionRef = {
            value: buildTmuxSessionName(featureId, 'cc', { repo: repoName, role: 'do', entityType: 'f' }),
        };

        // Create an autonomous-mode tmux session so sweepEntity treats this feature
        // as autonomous and calls the registered exhaustion handler.
        const autoSessionName = buildTmuxSessionName(featureId, null, { repo: repoName, role: 'auto', entityType: 'f' });
        try {
            await wf.startFeature(repo, featureId, 'solo_worktree', ['cc'], {
                agentFailover: { policy: 'switch', chain: ['cc', 'cx', 'ag'] },
            });

            writeAgentStatusAt(repo, featureId, 'cc', {
                status: 'needs_attention',
                worktreePath: repo,
                runtimeAgentId: 'cc',
                lastExitCode: 1,
                lastPaneTail: 'usage limit reached',
            }, 'feature');

            // Create the auto session and flush the tmux list cache so sweepEntity
            // sees it and marks the feature autonomous (required for policy=switch).
            createDetachedTmuxSession(autoSessionName, repo, 'tail -f /dev/null', {});
            _resetTmuxListCache();

            const snapshot = await wf.showFeatureOrNull(repo, featureId);
            sweepEntity(repo, 'feature', featureId, snapshot, {});
            await new Promise(r => setTimeout(r, 800));

            const events = readEvents(repo, featureId);
            const exhausted = events.filter(e => e.type === 'agent.token_exhausted');
            const switched = events.filter(e => e.type === 'agent.failover_switched');

            a.strictEqual(exhausted.length, 1, 'Sc1: exactly one token_exhausted event');
            a.strictEqual(exhausted[0].source, 'stderr_pattern', 'Sc1: source is stderr_pattern');
            a.strictEqual(switched.length, 1, 'Sc1: exactly one failover_switched event');
            a.strictEqual(switched[0].previousAgentId, 'cc', 'Sc1: previousAgentId is cc');
            a.strictEqual(switched[0].replacementAgentId, 'cx', 'Sc1: replacementAgentId is cx');

            const snap = await wf.showFeatureOrNull(repo, featureId);
            a.strictEqual(snap.agents.cc.currentAgentId, 'cx', 'Sc1: slot cc now runs cx');
            a.strictEqual(snap.agents.cc.resumedFromAgentId, 'cc', 'Sc1: resumedFromAgentId tracks prior runtime');
            a.strictEqual(snap.agents.cc.tokenExhausted, null, 'Sc1: tokenExhausted cleared after switch');

            a.ok(
                tmuxSessionAlive(sessionRef.value),
                `Sc1: tmux session ${sessionRef.value} should exist for cx replacement`
            );
        } finally {
            killSession(sessionRef.value);
            killSession(autoSessionName);
            _resetTmuxListCache();
            }
    });

    // -----------------------------------------------------------------------
    // Scenario 2: chain end — ag is last, no successor → no failover_switched
    // -----------------------------------------------------------------------
    await withTempDirAsync(async (repo) => {
        const featureId = '2';
        const sessionRef = { value: buildTmuxSessionName(featureId, 'ag', {
            repo: path.basename(repo), role: 'do', entityType: 'f',
        }) };

        try {
            await wf.startFeature(repo, featureId, 'solo_worktree', ['ag'], {
                agentFailover: { policy: 'switch', chain: ['cc', 'cx', 'ag'] },
            });

            writeAgentStatusAt(repo, featureId, 'ag', {
                status: 'needs_attention',
                worktreePath: repo,
                runtimeAgentId: 'ag',
                lastExitCode: 1,
                lastPaneTail: 'quota exceeded: token limit',
            }, 'feature');

            const snapshot = await wf.showFeatureOrNull(repo, featureId);
            sweepEntity(repo, 'feature', featureId, snapshot, {});
            await new Promise(r => setTimeout(r, 800));

            const events = readEvents(repo, featureId);
            const exhausted = events.filter(e => e.type === 'agent.token_exhausted');
            const switched = events.filter(e => e.type === 'agent.failover_switched');

            a.strictEqual(exhausted.length, 1, 'Sc2: token_exhausted recorded at chain end');
            a.strictEqual(exhausted[0].source, 'stderr_pattern', 'Sc2: source is stderr_pattern');
            a.strictEqual(switched.length, 0, 'Sc2: no failover_switched when chain has no successor');
        } finally {
            killSession(sessionRef.value);
            }
    });

    // -----------------------------------------------------------------------
    // Scenario 3: notify policy — exhaustion recorded, no switch, slot stays on cc
    // -----------------------------------------------------------------------
    await withTempDirAsync(async (repo) => {
        const featureId = '3';

        {
            await wf.startFeature(repo, featureId, 'solo_worktree', ['cc'], {
                agentFailover: { policy: 'notify', chain: ['cc', 'cx', 'ag'] },
            });

            writeAgentStatusAt(repo, featureId, 'cc', {
                status: 'needs_attention',
                worktreePath: repo,
                runtimeAgentId: 'cc',
                lastExitCode: 1,
                lastPaneTail: 'usage limit reached',
            }, 'feature');

            const snapshot = await wf.showFeatureOrNull(repo, featureId);
            sweepEntity(repo, 'feature', featureId, snapshot, {});
            await new Promise(r => setTimeout(r, 800));

            const events = readEvents(repo, featureId);
            const exhausted = events.filter(e => e.type === 'agent.token_exhausted');
            const switched = events.filter(e => e.type === 'agent.failover_switched');

            a.strictEqual(exhausted.length, 1, 'Sc3: token_exhausted recorded for notify policy');
            a.strictEqual(switched.length, 0, 'Sc3: no failover_switched for notify policy');

            const snap = await wf.showFeatureOrNull(repo, featureId);
            a.ok(snap.agents.cc.tokenExhausted, 'Sc3: tokenExhausted is set on the slot');
            a.strictEqual(snap.agents.cc.currentAgentId, 'cc', 'Sc3: slot stays on cc');
        }
    });

    delete process.env.AIGON_TEST_MODE;
}));

// ── appendFailoverDashboardActions (merged from the aigon-pro test suite) ─────

test('appendFailoverDashboardActions injects switch-agent when tokenExhausted set', () => {
    const snapshot = {
        agents: {
            cc: {
                status: 'needs_attention',
                tokenExhausted: { source: 'stderr_pattern', at: new Date().toISOString() },
                currentAgentId: 'cc',
            },
        },
        agentFailover: { policy: 'switch', chain: ['cc', 'cx', 'gg'] },
    };
    const agents = [{ id: 'cc', status: 'needs_attention' }];
    const result = agentFailover.appendFailoverDashboardActions(
        '/fake/repo', 'feature', '42', snapshot, agents, []
    );
    a.strictEqual(result.length, 1, 'one action injected');
    const action = result[0];
    a.strictEqual(action.action, 'switch-agent', 'action is switch-agent');
    a.strictEqual(action.agentId, 'cc', 'agentId is cc');
    a.strictEqual(action.metadata.nextAgentId, 'cx', 'next agent is cx');
    a.strictEqual(action.metadata.chainExhausted, false, 'chain not exhausted');
    a.ok(action.label.includes('cx'), 'label includes next agent id');
});

test('appendFailoverDashboardActions marks chainExhausted when no next agent', () => {
    const snapshot = {
        agents: {
            gg: {
                status: 'needs_attention',
                tokenExhausted: { source: 'stderr_pattern', at: new Date().toISOString() },
                currentAgentId: 'gg',
            },
        },
        agentFailover: { policy: 'switch', chain: ['cc', 'cx', 'gg'] },
    };
    const agents = [{ id: 'gg', status: 'needs_attention' }];
    const result = agentFailover.appendFailoverDashboardActions(
        '/fake/repo', 'feature', '42', snapshot, agents, []
    );
    a.strictEqual(result.length, 1, 'one action injected even when chain exhausted');
    a.strictEqual(result[0].metadata.chainExhausted, true, 'chainExhausted flagged');
    a.strictEqual(result[0].metadata.nextAgentId, null, 'no next agent');
});

test('appendFailoverDashboardActions skips slot without tokenExhausted', () => {
    const snapshot = {
        agents: { cc: { status: 'running', currentAgentId: 'cc' } },
        agentFailover: { policy: 'switch', chain: ['cc', 'cx'] },
    };
    const agents = [{ id: 'cc', status: 'running' }];
    const result = agentFailover.appendFailoverDashboardActions(
        '/fake/repo', 'feature', '42', snapshot, agents, []
    );
    a.strictEqual(result.length, 0, 'no action injected for healthy slot');
});

report();
