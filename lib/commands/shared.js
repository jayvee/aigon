'use strict';

// ── shared.js — command factory ───────────────────────────────────────────────
// Builds a combined ctx and spreads all domain command modules together.
// Domain files:
//   feedback.js  — feedback-create, feedback-list, feedback-triage
//   research.js  — research-* commands
//   feature.js   — feature-* commands, sessions-close
//   infra.js     — dashboard, terminal-focus, board, config, hooks,
//                  profile, proxy-setup, dev-server
//   setup.js     — init, install-agent, check-version, update, doctor
//   misc.js      — agent-status, status, deploy, next, help
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

const utils = require('../utils');
const hooksLib = require('../hooks');
const versionLib = require('../version');
const specCrud = require('../spec-crud');
const feedbackLib = require('../feedback');
const board = require('../board');
const validation = require('../validation');
const git = require('../git');
const { readAgentStatus } = require('../agent-status');

const feedbackCommands = require('./feedback');
const researchCommands = require('./research');
const featureCommands = require('./feature');
const infraCommands = require('./infra');
const setupCommands = require('./setup');
const miscCommands = require('./misc');
const { createScheduleCommands } = require('./schedule');

let _cachedCommands = null;

// Inline helper re-exported for tests / external callers
function collectIncompleteFeatureEvalAgents({ featureNum, worktrees = [] }) {
    const incompleteAgents = [];
    worktrees.forEach(w => {
        try {
            const agentState = readAgentStatus(featureNum, w.agent);
            const status = agentState ? (agentState.status || 'unknown') : 'unknown';
            if (status !== 'submitted') {
                incompleteAgents.push({ agent: w.agent, name: w.name, status });
            }
        } catch (e) { /* skip on read error */ }
    });
    return incompleteAgents;
}

function collectIncompleteResearchSynthesisAgents({ researchNum, logsDir, loadAgentConfig = utils.loadAgentConfig }) {
    if (!logsDir || !fs.existsSync(logsDir)) return [];
    const incompleteAgents = [];
    const findingsFiles = fs.readdirSync(logsDir)
        .filter(f => f.startsWith(`research-${researchNum}-`) && f.endsWith('-findings.md'))
        .sort();
    findingsFiles.forEach(file => {
        const match = file.match(/^research-\d+-([a-z]{2})-findings\.md$/);
        if (!match) return;
        try {
            const agent = match[1];
            const agentState = readAgentStatus(researchNum, agent, 'research') || readAgentStatus(researchNum, agent);
            const status = agentState ? (agentState.status || 'unknown') : 'unknown';
            if (status !== 'submitted') {
                const agentConfig = loadAgentConfig(agent);
                incompleteAgents.push({ agent, name: agentConfig?.name || agent, status });
            }
        } catch (e) { /* skip on read error */ }
    });
    return incompleteAgents;
}

function buildIncompleteSubmissionReconnectCommand({ mode, id, agent }) {
    if (mode === 'research') {
        return `aigon terminal-focus ${id} ${agent} --research`;
    }
    return agent ? `aigon terminal-focus ${id} ${agent}` : `aigon terminal-focus ${id}`;
}

function buildCtx(overrides = {}) {
    return {
        utils: { ...utils, ...overrides },
        hooks: { ...hooksLib, ...overrides },
        version: { ...versionLib, ...overrides },
        specCrud: { ...specCrud, ...overrides },
        git: { ...git, ...overrides },
        board: { ...board, ...overrides },
        feedback: { ...feedbackLib, ...overrides },
        validation: { ...validation, ...overrides },
    };
}

function createAllCommands(overrides = {}) {
    if (_cachedCommands && Object.keys(overrides).length === 0) return _cachedCommands;

    const ctx = buildCtx(overrides);

    const commands = {
        ...feedbackCommands(ctx),
        ...researchCommands(ctx),
        ...featureCommands(ctx),
        ...infraCommands(ctx),
        ...setupCommands(ctx),
        ...miscCommands(ctx),
        ...createScheduleCommands(),

        // Deprecated aliases — delegate to their current canonical command
        'feature-implement': (args) => {
            console.warn('⚠️  Deprecated: "feature-implement" has been renamed to "feature-do". Please update your workflow.');
            commands['feature-do'](args);
        },
        'feature-done': (args) => {
            console.warn('⚠️  Deprecated: "feature-done" has been renamed to "feature-close". Please update your workflow.');
            commands['feature-close'](args);
        },
        'feature-review': (args) => {
            console.warn('⚠️  Deprecated: "feature-review" has been renamed to "feature-code-review". Please update your workflow.');
            commands['feature-code-review'](args);
        },
        'research-conduct': (args) => {
            console.warn('⚠️  Deprecated: "research-conduct" has been renamed to "research-do". Please update your workflow.');
            commands['research-do'](args);
        },
        'research-done': (args) => {
            console.warn('⚠️  Deprecated: "research-done" has been renamed to "research-close". Please update your workflow.');
            commands['research-close'](args);
        },
    };

    if (Object.keys(overrides).length === 0) _cachedCommands = commands;
    return commands;
}

module.exports = {
    createAllCommands,
    buildIncompleteSubmissionReconnectCommand,
    collectIncompleteFeatureEvalAgents,
    collectIncompleteResearchSynthesisAgents,
};
