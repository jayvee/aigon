'use strict';

const createLegacyCommands = require('./setup-legacy');

const handlerFactories = {
    'init': require('./setup/init'),
    'install-agent': require('./setup/install-agent'),
    'apply': require('./setup/apply'),
    'update': require('./setup/update'),
    'doctor': require('./setup/doctor'),
    'uninstall': require('./setup/uninstall'),
    'remove': require('./setup/remove'),
    'setup': require('./setup/setup'),
    'global-setup': require('./setup/global-setup'),
    'check-prerequisites': require('./setup/check-prerequisites'),
    'check-version': require('./setup/check-version'),
    'installed-notice': require('./setup/installed-notice'),
    'project-context': require('./setup/project-context'),
    'trust-worktree': require('./setup/trust-worktree'),
    'install-seed': require('./setup/install-seed'),
    'seed-reset': require('./setup/seed-reset').createCommand,
};

const SETUP_COMMAND_NAMES = Object.keys(handlerFactories);

module.exports = function setupCommands(ctx) {
    const legacyCommands = createLegacyCommands(ctx);
    return Object.fromEntries(SETUP_COMMAND_NAMES.map(name => [
        name,
        handlerFactories[name](ctx, legacyCommands),
    ]));
};

function createSetupCommands(overrides = {}) {
    const utils = require('../utils');
    const versionLib = require('../version');
    const specCrud = require('../spec-crud');
    const git = require('../git');
    const board = require('../board');
    const feedbackLib = require('../feedback');
    const validation = require('../validation');
    const stateMachine = require('../state-queries');

    const ctx = {
        utils: { ...utils, ...overrides },
        version: { ...versionLib, ...overrides },
        specCrud: { ...specCrud, ...overrides },
        git: { ...git, ...overrides },
        board: { ...board, ...overrides },
        feedback: { ...feedbackLib, ...overrides },
        validation: { ...validation, ...overrides },
        stateMachine,
    };
    const allCmds = module.exports(ctx);
    return Object.fromEntries(SETUP_COMMAND_NAMES.map(n => [n, allCmds[n]]).filter(([, h]) => typeof h === 'function'));
}

module.exports.createSetupCommands = createSetupCommands;
module.exports._test = createLegacyCommands._test;
