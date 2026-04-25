#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, report } = require('../_helpers');
const sk = require('../../lib/scheduled-kickoff');
const agentRegistry = require('../../lib/agent-registry');
const { validateFeatureAutonomousPayload } = require('../../lib/feature-autonomous-payload');

// REGRESSION: token-window config schema must exist and command must be registered.
test('token-window config defaults and command registry', () => {
    const config = require('../../lib/config');
    const defaults = config.DEFAULT_GLOBAL_CONFIG;
    assert.ok(defaults.tokenWindow, 'DEFAULT_GLOBAL_CONFIG must have tokenWindow key');
    assert.strictEqual(defaults.tokenWindow.message, 'Checking in to align token window');
    assert.deepStrictEqual(defaults.tokenWindow.targetAgents, []);
    assert.strictEqual(defaults.tokenWindow.timezone, null);

    const templates = require('../../lib/templates');
    assert.ok(templates.COMMAND_REGISTRY['token-window'], 'token-window must be in COMMAND_REGISTRY');
    assert.ok(templates.COMMANDS_DISABLE_MODEL_INVOCATION.has('token-window'), 'token-window must disable model invocation');
});

// REGRESSION: /api/budget must include lastTokenKickoffAt when state file exists.
test('budget route includes lastTokenKickoffAt source', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../lib/dashboard-routes.js'), 'utf8');
    assert.ok(src.includes('last-token-kickoff'), 'dashboard-routes must reference last-token-kickoff');
    assert.ok(src.includes('lastTokenKickoffAt'), 'dashboard-routes must include lastTokenKickoffAt in response');
});

// REGRESSION: token-window command handler must exist in misc commands.
test('token-window command exported from misc commands', () => {
    const misc = require('../../lib/commands/misc');
    const ctx = {
        utils: {
            PATHS: { features: { root: path.join(process.cwd(), 'docs', 'specs', 'features') } },
            readTemplate: () => '',
            processTemplate: (x) => x,
            runDeployCommand: () => 0,
            upsertLogFrontmatterScalars: () => {},
            getStateDir: () => path.join(process.cwd(), '.aigon', 'state'),
            safeRemoveWorktree: () => true,
            removeWorktreePermissions: () => {},
            removeWorktreeTrust: () => {},
            gcCaddyRoutes: () => {},
            getAvailableAgents: () => ['cc', 'cx', 'gg', 'cu'],
            parseConfigScope: (args) => ({ scope: 'global', remainingArgs: args }),
        },
        git: {
            getCurrentBranch: () => 'main',
            getCommitAnalytics: () => ({ commits: [] }),
            filterCommitAnalytics: (c) => c,
            buildCommitAnalyticsSummary: () => ({}),
            getDefaultBranch: () => 'main',
            getMainRepoPath: () => process.cwd(),
            getStatus: () => '',
            listBranches: () => [],
            listWorktrees: () => [],
            filterWorktreesByFeature: () => [],
        },
    };
    const cmds = misc(ctx);
    assert.strictEqual(typeof cmds['token-window'], 'function', 'token-window must be a function');
});

// REGRESSION F367: scheduled kickoffs — registry, runAt validation, single-fire + cancel.
test('schedule command registered and scheduled-kickoff core invariants', () => {
    const templates = require('../../lib/templates');
    assert.ok(templates.COMMAND_REGISTRY.schedule, 'schedule must be in COMMAND_REGISTRY');
    assert.ok(templates.COMMANDS_DISABLE_MODEL_INVOCATION.has('schedule'), 'schedule must disable model invocation');
    const shared = require('../../lib/commands/shared');
    const all = shared.createAllCommands();
    assert.strictEqual(typeof all.schedule, 'function', 'schedule handler must exist');

    const bad = sk.parseRunAt('2026-04-26T01:10:00');
    assert.strictEqual(bad.ok, false);
    const badAgents = validateFeatureAutonomousPayload({ featureId: '42', agents: ['zz'], stopAfter: 'close' }, agentRegistry);
    assert.strictEqual(badAgents.ok, false);
});

// REGRESSION F367: due pending job fires once; cancelled job never spawns.
test('scheduled kickoff poller fires once and respects cancel', () => withTempDir('aigon-sk-', (repo) => {
    fs.mkdirSync(path.join(repo, 'docs/specs/features/02-backlog'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'docs/specs/features/02-backlog/feature-01-x.md'), '# x\n');
    const engine = require('../../lib/workflow-core/engine');
    engine.ensureEntityBootstrappedSync(repo, 'feature', '01', 'backlog', path.join(repo, 'docs/specs/features/02-backlog/feature-01-x.md'));
    const past = '2020-01-01T00:00:00Z';
    const cliEntry = path.join(__dirname, '../../aigon-cli.js');
    const spawnSyncImpl = () => ({ status: 0, stdout: 'AutoConductor started: mock\n', stderr: '' });
    const spawns = [];
    const track = () => { spawns.push(1); return spawnSyncImpl(); };

    assert.strictEqual(sk.addJob(repo, { kind: 'feature_autonomous', entityId: '01', runAt: past, payload: { agents: ['cc'], stopAfter: 'close' } }).ok, true);
    assert.strictEqual(sk.addJob(repo, { kind: 'feature_autonomous', entityId: '01', runAt: past, payload: { agents: ['cc'], stopAfter: 'close' } }).ok, true);
    sk.processRepoDueJobs(repo, { now: () => Date.now(), spawnSyncImpl: track, cliEntryPath: cliEntry });
    assert.strictEqual(spawns.length, 2);
    sk.processRepoDueJobs(repo, { now: () => Date.now(), spawnSyncImpl: track, cliEntryPath: cliEntry });
    assert.strictEqual(spawns.length, 2);
    const r3 = sk.addJob(repo, { kind: 'feature_autonomous', entityId: '01', runAt: past, payload: { agents: ['cc'], stopAfter: 'close' } });
    sk.cancelJob(repo, r3.job.jobId);
    const n = spawns.length;
    sk.processRepoDueJobs(repo, { now: () => Date.now(), spawnSyncImpl: track, cliEntryPath: cliEntry });
    assert.strictEqual(spawns.length, n);
}));

report();
