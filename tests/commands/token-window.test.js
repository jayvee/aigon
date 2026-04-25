#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, report } = require('../_helpers');

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

report();
