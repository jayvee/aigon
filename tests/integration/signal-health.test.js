#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { test, withTempDir, report, GIT_SAFE_ENV } = require('../_helpers');
const agentStatus = require('../../lib/agent-status');
const signalHealth = require('../../lib/signal-health');

const CLI_PATH = path.join(__dirname, '..', '..', 'aigon-cli.js');

function cli(args, cwd) {
    return spawnSync(process.execPath, [CLI_PATH, ...args], {
        cwd,
        env: { ...process.env, ...GIT_SAFE_ENV },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

test('signal-health records emitted status writes and reports via CLI', () => withTempDir('aigon-signal-health-', (repo) => {
    agentStatus.writeAgentStatusAt(repo, '01', 'cx', { status: 'implementing' }, 'feature');
    agentStatus.writeAgentStatusAt(repo, '01', 'cx', { status: 'implementation-complete' }, 'feature');

    const events = signalHealth.readSignalEvents({ repoPath: repo, since: '2000-01-01', agent: 'cx' });
    assert.strictEqual(events.filter(event => event.kind === 'signal-emitted').length, 2);
    assert.ok(events.every(event => event.entityType === 'feature' && event.entityId === '01'));

    const result = cli(['signal-health', '--agent', 'cx', '--since', '2000-01-01', '--json'], repo);
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.summary[0].agent, 'cx');
    assert.strictEqual(payload.summary[0].emitted, 2);
}));

test('signal-recovered-via-nudge is recorded only after status advances post-nudge', () => withTempDir('aigon-signal-nudge-rec-', (repo) => {
    // REGRESSION: feature 443 — recovered-via-nudge must not fire on nudge dispatch alone (spec AC).
    agentStatus.writeAgentStatusAt(repo, '01', 'cx', { status: 'implementing' }, 'feature');
    signalHealth.writeNudgeRecoveryPending(repo, {
        entityType: 'feature',
        entityId: '01',
        agent: 'cx',
        stuckStatus: 'implementing',
        sessionName: 'demo-sess',
    });
    agentStatus.writeAgentStatusAt(repo, '01', 'cx', { status: 'implementation-complete' }, 'feature');

    const events = signalHealth.readSignalEvents({ repoPath: repo, since: '2000-01-01', agent: 'cx' });
    assert.strictEqual(events.filter(e => e.kind === 'signal-recovered-via-nudge').length, 1);
    assert.strictEqual(events.filter(e => e.kind === 'signal-emitted').length, 2);
}));

test('signal-health records a missed signal once per status timestamp', () => withTempDir('aigon-signal-missed-', (repo) => {
    const old = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    signalHealth.recordMissedSignalIfDue({
        repoPath: repo,
        entityType: 'feature',
        entityId: '02',
        agent: 'gg',
        lastStatus: 'implementing',
        lastStatusAt: old,
        sessionName: 'aigon-f02-do-gg-demo',
    });
    signalHealth.recordMissedSignalIfDue({
        repoPath: repo,
        entityType: 'feature',
        entityId: '02',
        agent: 'gg',
        lastStatus: 'implementing',
        lastStatusAt: old,
        sessionName: 'aigon-f02-do-gg-demo',
    });

    const events = signalHealth.readSignalEvents({ repoPath: repo, since: '2000-01-01', agent: 'gg', kind: 'signal-missed' });
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].elapsedSec >= 600, true);

    const today = new Date().toISOString().slice(0, 10);
    assert.ok(fs.existsSync(path.join(repo, '.aigon', 'telemetry', 'signal-health', `${today}.jsonl`)));
}));

report();
