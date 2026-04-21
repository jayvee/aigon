'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const stateMachine = require('./state-queries');
const git = require('./git');

// Sub-modules — extracted from utils.js; re-exported below for backward compat
const config = require('./config');
const deploy = require('./deploy');
const proxy = require('./proxy');
const templates = require('./templates');
const worktree = require('./worktree');
const dashboard = require('./dashboard-server');

// Destructure what the remaining utils.js code still references locally
const { loadProjectConfig } = config;
const { detectDevServerContext, isProxyAvailable, getDevProxyUrl } = proxy;
const { PATHS } = templates;

function getStateDir() {
    return path.join(process.cwd(), '.aigon', 'state');
}


const FEEDBACK_STATUS_TO_FOLDER = {
    'inbox': '01-inbox',
    'triaged': '02-triaged',
    'actionable': '03-actionable',
    'done': '04-done',
    'wont-fix': '05-wont-fix',
    'duplicate': '06-duplicate'
};
const FEEDBACK_FOLDER_TO_STATUS = Object.fromEntries(
    Object.entries(FEEDBACK_STATUS_TO_FOLDER).map(([status, folder]) => [folder, status])
);
const FEEDBACK_STATUS_FLAG_TO_FOLDER = {
    'inbox': FEEDBACK_STATUS_TO_FOLDER['inbox'],
    'triaged': FEEDBACK_STATUS_TO_FOLDER['triaged'],
    'actionable': FEEDBACK_STATUS_TO_FOLDER['actionable'],
    'done': FEEDBACK_STATUS_TO_FOLDER['done'],
    'wont-fix': FEEDBACK_STATUS_TO_FOLDER['wont-fix'],
    'duplicate': FEEDBACK_STATUS_TO_FOLDER['duplicate']
};
const FEEDBACK_ACTION_TO_STATUS = {
    'keep': 'triaged',
    'mark-duplicate': 'duplicate',
    'duplicate': 'duplicate',
    'promote-feature': 'actionable',
    'promote-research': 'actionable',
    'wont-fix': 'wont-fix'
};
const FEEDBACK_DEFAULT_LIST_FOLDERS = [
    FEEDBACK_STATUS_TO_FOLDER['inbox'],
    FEEDBACK_STATUS_TO_FOLDER['triaged'],
    FEEDBACK_STATUS_TO_FOLDER['actionable']
];

function resolveDevServerUrl(context = detectDevServerContext(), proxyAvailable = isProxyAvailable()) {
    if (proxyAvailable) {
        return getDevProxyUrl(context.appId, context.serverId);
    }

    const envLocalPath = path.join(process.cwd(), '.env.local');
    if (fs.existsSync(envLocalPath)) {
        const content = fs.readFileSync(envLocalPath, 'utf8');
        const match = content.match(/^PORT=(\d+)/m);
        if (match) {
            return `http://localhost:${match[1]}`;
        }
    }

    const projectConfig = loadProjectConfig();
    const devProxy = projectConfig.devProxy || {};
    const basePort = devProxy.basePort;
    const agentOffsets = require('./agent-registry').getPortOffsets();
    const offset = context.agentId ? (agentOffsets[context.agentId] || 0) : 0;
    return `http://localhost:${basePort + offset}`;
}

const runGit = git.run;

/**
 * Set terminal tab/window title using ANSI escape sequences.
 * Works in most terminals including Warp, iTerm2, Terminal.app, etc.
 * @param {string} title - The title to set
 */
function setTerminalTitle(title) {
    // Only set title if we're in an interactive terminal (not piped)
    if (process.stdout.isTTY) {
        // OSC 0 = set icon name and window title
        // ESC ] 0 ; <title> BEL
        process.stdout.write(`\x1b]0;${title}\x07`);
    }
}

function safeWrite(filePath, content) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content);
}

// Returns 'created', 'updated', or 'unchanged'
function safeWriteWithStatus(filePath, content) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    if (fs.existsSync(filePath)) {
        const existing = fs.readFileSync(filePath, 'utf8');
        if (existing === content) {
            return 'unchanged';
        }
        fs.writeFileSync(filePath, content);
        return 'updated';
    }
    fs.writeFileSync(filePath, content);
    return 'created';
}


// ---------------------------------------------------------------------------
// Module exports — backward-compatible re-exports from sub-modules + own APIs
// ---------------------------------------------------------------------------
// NOTE: Use Object.assign, not `module.exports = { ... }`. utils.js sits in a
// circular require chain (utils → dashboard-server → dashboard-status-collector
// → feedback → utils). Replacing module.exports with a new object means
// modules that required utils during the cycle (e.g. feedback.js) end up with
// a reference to the *original* empty exports object and never see any of the
// properties below. Mutating the existing object keeps those references live.
// Re-introducing `module.exports = { ... }` here crashed the server on startup
// on 2026-04-19 once F273 added a runtime reader for FEEDBACK_STATUS_TO_FOLDER.
Object.assign(module.exports, {
    // ── config ──
    ...config,

    // ── proxy ──
    ...proxy,

    // ── dashboard-server ──
    ...dashboard,

    // ── worktree ──
    ...worktree,

    // ── templates ──
    ...templates,

    // ── state-machine (feature/research action derivation moved to workflow-core engine) ──
    getSessionAction: stateMachine.getSessionAction,

    // ── git re-exports (shared.js scope picks these up) ──
    getCurrentBranch: git.getCurrentBranch,
    getCurrentHead: git.getCurrentHead,
    getDefaultBranch: git.getDefaultBranch,
    branchExists: git.branchExists,
    listBranches: git.listBranches,
    getCommonDir: git.getCommonDir,
    getStatusRaw: git.getStatusRaw,
    ensureCommit: git.ensureCommit,
    getStateDir,

    // ── feedback constants (unique to utils.js) ──
    FEEDBACK_STATUS_TO_FOLDER,
    FEEDBACK_FOLDER_TO_STATUS,
    FEEDBACK_STATUS_FLAG_TO_FOLDER,
    FEEDBACK_ACTION_TO_STATUS,
    FEEDBACK_DEFAULT_LIST_FOLDERS,

    // ── dev server ──
    resolveDevServerUrl,

    // ── git delegated ──
    runGit,

    // ── terminal / file utils ──
    setTerminalTitle,
    safeWrite,
    safeWriteWithStatus,

    // ── deploy ──
    ...deploy,
});
