#!/usr/bin/env node
'use strict';

const a = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { testAsync, withTempDirAsync, report, withIsolatedTmuxAsync } = require('../_helpers');
const wf = require('../../lib/workflow-core');
const { writeAgentStatusAt } = require('../../lib/agent-status');
const {
    sweepEntity,
    registerExhaustionHandler,
    tmuxSessionAlive,
    _resetExhaustionHandlers,
} = require('../../lib/supervisor');
const { chooseNextAgent } = require('../../lib/agent-exhaustion-detect');
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

// Build a handler that implements the chain-switch logic (mirrors what @aigon/pro registers).
function makeSwitchHandler(capturedSessionName) {
    return async function ({ repoPath, entityId, agentId, signal, failoverConfig }) {
        const replacementAgentId = chooseNextAgent(
            failoverConfig.chain, signal.currentAgentId, [signal.currentAgentId]
        );
        if (!replacementAgentId) return;

        await wf.recordAgentFailoverSwitch(repoPath, entityId, {
            agentId,
            previousAgentId: signal.currentAgentId,
            replacementAgentId,
            source: signal.source,
            lastCommit: null,
        });

        createDetachedTmuxSession(capturedSessionName.value, repoPath, 'tail -f /dev/null', {});
    };
}

// Run all three scenarios sequentially to avoid contaminating the module-level
// exhaustionHandlers array that supervisor uses.
testAsync('agent-failover-end-to-end: all scenarios', async () => withIsolatedTmuxAsync(async () => {
    process.env.AIGON_TEST_MODE = '1';

    // -----------------------------------------------------------------------
    // Scenario 1: switch policy — cc exhausted, cx is next
    // -----------------------------------------------------------------------
    await withTempDirAsync(async (repo) => {
        _resetExhaustionHandlers();
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
                agentFailover: { policy: 'switch', chain: ['cc', 'cx', 'gg'] },
            });

            writeAgentStatusAt(repo, featureId, 'cc', {
                status: 'needs_attention',
                worktreePath: repo,
                runtimeAgentId: 'cc',
                lastExitCode: 1,
                lastPaneTail: 'usage limit reached',
            }, 'feature');

            registerExhaustionHandler(makeSwitchHandler(sessionRef));

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
            _resetExhaustionHandlers();
        }
    });

    // -----------------------------------------------------------------------
    // Scenario 2: chain end — gg is last, no successor → no failover_switched
    // -----------------------------------------------------------------------
    await withTempDirAsync(async (repo) => {
        _resetExhaustionHandlers();
        const featureId = '2';
        const sessionRef = { value: buildTmuxSessionName(featureId, 'gg', {
            repo: path.basename(repo), role: 'do', entityType: 'f',
        }) };

        try {
            await wf.startFeature(repo, featureId, 'solo_worktree', ['gg'], {
                agentFailover: { policy: 'switch', chain: ['cc', 'cx', 'gg'] },
            });

            writeAgentStatusAt(repo, featureId, 'gg', {
                status: 'needs_attention',
                worktreePath: repo,
                runtimeAgentId: 'gg',
                lastExitCode: 1,
                lastPaneTail: 'quota exceeded: token limit',
            }, 'feature');

            registerExhaustionHandler(makeSwitchHandler(sessionRef));

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
            _resetExhaustionHandlers();
        }
    });

    // -----------------------------------------------------------------------
    // Scenario 3: notify policy — exhaustion recorded, no switch, slot stays on cc
    // -----------------------------------------------------------------------
    await withTempDirAsync(async (repo) => {
        _resetExhaustionHandlers();
        const featureId = '3';

        try {
            await wf.startFeature(repo, featureId, 'solo_worktree', ['cc'], {
                agentFailover: { policy: 'notify', chain: ['cc', 'cx', 'gg'] },
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
        } finally {
            _resetExhaustionHandlers();
        }
    });

    delete process.env.AIGON_TEST_MODE;
}));

report();
