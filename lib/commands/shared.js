'use strict';

// ── shared.js — command factory ───────────────────────────────────────────────
// Builds a combined ctx and spreads all domain command modules together.
// Domain files:
//   feedback.js  — feedback-create, feedback-list, feedback-triage
//   research.js  — research-* commands
//   feature.js   — feature-* commands, sessions-close
//   infra.js     — conductor, dashboard, terminal-focus, board, config, hooks,
//                  profile, proxy-setup, dev-server
//   setup.js     — init, install-agent, check-version, update, doctor
//   misc.js      — agent-status, status, deploy, next, help
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

const utils = require('../utils');
const feedbackLib = require('../feedback');
const board = require('../board');
const validation = require('../validation');
const git = require('../git');
const stateMachine = require('../state-machine');

const feedbackCommands = require('./feedback');
const researchCommands = require('./research');
const featureCommands = require('./feature');
const infraCommands = require('./infra');
const setupCommands = require('./setup');
const miscCommands = require('./misc');

let _cachedCommands = null;

// Helper re-exported for backward compatibility (used by conductor menubar and
// domain files that include inline copies of this function).
function parseFrontMatterStatus(content) {
    const m = content.match(/^---\n([\s\S]*?)\n---\n/);
    if (!m) return null;
    const sm = m[1].match(/status:\s*(\S+)/);
    return sm ? sm[1] : null;
}

// Inline helper re-exported for tests / external callers
function collectIncompleteFeatureEvalAgents({ featureNum, worktrees = [] }) {
    const incompleteAgents = [];
    worktrees.forEach(w => {
        const worktreeLogsDir = path.join(w.path, 'docs/specs/features/logs');
        if (!fs.existsSync(worktreeLogsDir)) return;
        try {
            const logFiles = fs.readdirSync(worktreeLogsDir)
                .filter(f => f.startsWith(`feature-${featureNum}-${w.agent}-`) && f.endsWith('-log.md'))
                .sort();
            if (logFiles.length === 0) return;
            const logContent = fs.readFileSync(path.join(worktreeLogsDir, logFiles[0]), 'utf8');
            const status = parseFrontMatterStatus(logContent) || 'unknown';
            if (status !== 'submitted') {
                incompleteAgents.push({ agent: w.agent, name: w.name, status });
            }
        } catch (e) { /* skip on read error */ } // optional
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
            const content = fs.readFileSync(path.join(logsDir, file), 'utf8');
            const status = parseFrontMatterStatus(content) || 'unknown';
            if (status !== 'submitted') {
                const agent = match[1];
                const agentConfig = loadAgentConfig(agent);
                incompleteAgents.push({ agent, name: agentConfig?.name || agent, status });
            }
        } catch (e) { /* skip on read error */ } // optional
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
        git: { ...git, ...overrides },
        board: { ...board, ...overrides },
        feedback: { ...feedbackLib, ...overrides },
        validation: { ...validation, ...overrides },
        stateMachine,
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

        // Deprecated aliases — delegate to their current canonical command
        'feature-implement': (args) => {
            console.warn('⚠️  Deprecated: "feature-implement" has been renamed to "feature-do". Please update your workflow.');
            commands['feature-do'](args);
        },
        'feature-done': (args) => {
            console.warn('⚠️  Deprecated: "feature-done" has been renamed to "feature-close". Please update your workflow.');
            commands['feature-close'](args);
        },
        'research-conduct': (args) => {
            console.warn('⚠️  Deprecated: "research-conduct" has been renamed to "research-do". Please update your workflow.');
            commands['research-do'](args);
        },
        'research-done': (args) => {
            console.warn('⚠️  Deprecated: "research-done" has been renamed to "research-close". Please update your workflow.');
            commands['research-close'](args);
        },
        'conduct': (args) => {
            console.warn('⚠️  Deprecated: "conduct" has been renamed to "feature-autopilot". Please update your workflow.');
            commands['feature-autopilot'](args);
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
    parseFrontMatterStatus,
};
