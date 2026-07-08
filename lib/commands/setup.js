'use strict';

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
    'seed-reset': require('./setup/seed-reset-run'),
};

const SETUP_COMMAND_NAMES = Object.keys(handlerFactories);

module.exports = function setupCommands(ctx) {
    const commands = {};
    const getCommand = (name) => commands[name];
    for (const name of SETUP_COMMAND_NAMES) {
        commands[name] = handlerFactories[name](ctx, getCommand);
    }
    return commands;
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

const gitignoreAndHooks = require('./setup/gitignore-and-hooks');
const agentTrust = require('./setup/agent-trust');
const seedReset = require('./setup/seed-reset');

module.exports._test = {
    ...gitignoreAndHooks,
    findEntitiesMissingWorkflowState: agentTrust.findEntitiesMissingWorkflowState,
    bootstrapMissingWorkflowSnapshots: agentTrust.bootstrapMissingWorkflowSnapshots,
    rebuildSeedFeatureManifests: seedReset.rebuildSeedFeatureManifests,
    findSeedResetBaseline: seedReset.findSeedResetBaseline,
    normalizeGitHubRepoSlug: seedReset.normalizeGitHubRepoSlug,
    collectSeedResetRemoteUrls: seedReset.collectSeedResetRemoteUrls,
    parseSeedResetRemoteHeads: seedReset.parseSeedResetRemoteHeads,
    cleanupSeedResetRemoteBranches: seedReset.cleanupSeedResetRemoteBranches,
    closeSeedResetOpenPullRequests: seedReset.closeSeedResetOpenPullRequests,
    stripSeedResetStaleConfigKeys: seedReset.stripSeedResetStaleConfigKeys,
    ensureEnvLocalGitignore: gitignoreAndHooks.ensureEnvLocalGitignore,
    ensureLocalGitExclude: gitignoreAndHooks.ensureLocalGitExclude,
    getInstalledVersionAt: gitignoreAndHooks.getInstalledVersionAt,
    getEnvLocalGitignoreStatus: gitignoreAndHooks.getEnvLocalGitignoreStatus,
    getTrackedEnvLocalFiles: gitignoreAndHooks.getTrackedEnvLocalFiles,
    untrackFiles: gitignoreAndHooks.untrackFiles,
    ensurePreCommitHook: gitignoreAndHooks.ensurePreCommitHook,
    readHooksPath: gitignoreAndHooks.readHooksPath,
    isHooksPathConfigured: gitignoreAndHooks.isHooksPathConfigured,
    ensureHooksPathConfigured: gitignoreAndHooks.ensureHooksPathConfigured,
    PRE_COMMIT_HOOK_CONTENT: gitignoreAndHooks.PRE_COMMIT_HOOK_CONTENT,
};
