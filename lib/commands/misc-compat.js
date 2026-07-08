'use strict';

const utils = require('../utils');
const git = require('../git');
const board = require('../board');
const feedbackLib = require('../feedback');
const validation = require('../validation');
const stateMachine = require('../state-queries');
const agentSignalsCommands = require('./agent-signals');
const opsCommands = require('./ops');
const insightsCommands = require('./insights');
const { getFeatureSubmissionEvidence } = require('../feature-command-helpers');

function createMiscCommands(overrides = {}) {
    const ctx = {
        utils: { ...utils, ...overrides },
        git: { ...git, ...overrides },
        board: { ...board, ...overrides },
        feedback: { ...feedbackLib, ...overrides },
        validation: { ...validation, ...overrides },
        stateMachine,
    };
    const allCmds = {
        ...agentSignalsCommands(ctx),
        ...opsCommands(ctx),
        ...insightsCommands(ctx),
    };
    const names = ['nudge', 'agent-status', 'agent-context', 'repair', 'status', 'deploy', 'commits', 'insights', 'capture-session-telemetry', 'capture-antigravity-telemetry', 'session-list', 'security-scan-commit', 'check-agent-signal', 'check-agent-submitted', 'next', 'workflow-rules', 'help', 'rollout', 'stats', 'token-window', 'agent-probe', 'agent-quota', 'agent-resume'];
    return Object.fromEntries(names.map(n => [n, allCmds[n]]).filter(([, h]) => typeof h === 'function'));
}

module.exports = { createMiscCommands, getFeatureSubmissionEvidence };
