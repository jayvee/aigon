'use strict';

const utils = require('./utils');

module.exports = {
    getWorktreeBase: utils.getWorktreeBase,
    findWorktrees: utils.findWorktrees,
    filterByFeatureId: utils.filterByFeatureId,
    buildAgentCommand: utils.buildAgentCommand,
    buildResearchAgentCommand: utils.buildResearchAgentCommand,
    toUnpaddedId: utils.toUnpaddedId,
    buildTmuxSessionName: utils.buildTmuxSessionName,
    assertTmuxAvailable: utils.assertTmuxAvailable,
    tmuxSessionExists: utils.tmuxSessionExists,
    createDetachedTmuxSession: utils.createDetachedTmuxSession,
    shellQuote: utils.shellQuote,
    openTerminalAppWithCommand: utils.openTerminalAppWithCommand,
    ensureTmuxSessionForWorktree: utils.ensureTmuxSessionForWorktree,
    openInWarpSplitPanes: utils.openInWarpSplitPanes,
    closeWarpWindow: utils.closeWarpWindow,
    openSingleWorktree: utils.openSingleWorktree,
    addWorktreePermissions: utils.addWorktreePermissions,
    removeWorktreePermissions: utils.removeWorktreePermissions,
    presetWorktreeTrust: utils.presetWorktreeTrust,
    removeWorktreeTrust: utils.removeWorktreeTrust,
    presetCodexTrust: utils.presetCodexTrust,
    setupWorktreeEnvironment: utils.setupWorktreeEnvironment,
    ensureAgentSessions: utils.ensureAgentSessions,
};
