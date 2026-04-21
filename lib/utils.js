'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');
const stateMachine = require('./state-queries');
const git = require('./git');

// Sub-modules — extracted from utils.js; re-exported below for backward compat
const config = require('./config');
const proxy = require('./proxy');
const templates = require('./templates');
const worktree = require('./worktree');
const dashboard = require('./dashboard-server');

// Destructure what the remaining utils.js code still references locally
const { ROOT_DIR, openInEditor, loadProjectConfig } = config;
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


/**
 * Resolve the deploy command from config or package.json.
 * @param {boolean} isPreview - true for --preview, false for production
 * @returns {string|null} resolved shell command, or null if not configured
 */
function resolveDeployCommand(isPreview) {
    const key = isPreview ? 'preview' : 'deploy';

    // 1. Check .aigon/config.json → commands.deploy / commands.preview
    const projectConfig = loadProjectConfig();
    if (projectConfig?.commands?.[key]) {
        return projectConfig.commands[key];
    }

    // 2. Fall back to package.json scripts.deploy / scripts.preview
    const pkgPath = path.join(process.cwd(), 'package.json');
    if (fs.existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            if (pkg?.scripts?.[key]) {
                return `npm run ${key}`;
            }
        } catch (e) { /* ignore parse errors */ }
    }

    return null;
}

/**
 * Run the resolved deploy command, streaming output to the terminal.
 * @param {boolean} isPreview
 * @returns {number} exit code
 */
function runDeployCommand(isPreview) {
    const cmd = resolveDeployCommand(isPreview);
    const label = isPreview ? 'preview' : 'deploy';

    if (!cmd) {
        console.error(`❌ No ${label} command configured.`);
        console.error(`\nTo configure, add to .aigon/config.json:`);
        console.error(`  {`);
        console.error(`    "commands": {`);
        if (isPreview) {
            console.error(`      "preview": "vercel"`);
        } else {
            console.error(`      "deploy": "vercel --prod"`);
        }
        console.error(`    }`);
        console.error(`  }`);
        console.error(`\nOr add a "${label}" script to package.json.`);
        return 1;
    }

    console.log(`🚀 Running ${label}: ${cmd}`);
    const result = spawnSync(cmd, { stdio: 'inherit', shell: true });

    if (result.error) {
        console.error(`❌ Failed to run deploy command: ${result.error.message}`);
        return 1;
    }
    return result.status ?? 0;
}


// ---------------------------------------------------------------------------
// Eval file helpers
// ---------------------------------------------------------------------------

/**
 * Parse a feature eval file and return its status string.
 * Returns 'pick winner' if a winner has been selected, 'evaluating' otherwise.
 *
 * @param {string} evalsDir - path to the evaluations directory
 * @param {string} featureId - feature ID (numeric string)
 * @returns {'evaluating'|'pick winner'}
 */
function parseEvalFileStatus(evalsDir, featureId) {
    const evalFile = path.join(evalsDir, `feature-${featureId}-eval.md`);
    if (!fs.existsSync(evalFile)) return 'evaluating';
    try {
        const content = fs.readFileSync(evalFile, 'utf8');
        const winnerMatch = content.match(/\*\*Winner[:\s]*\*?\*?\s*(.+)/i);
        if (winnerMatch) {
            const val = winnerMatch[1].replace(/\*+/g, '').trim();
            if (val && !val.includes('to be determined') && !val.includes('TBD') && val !== '()') {
                return 'pick winner';
            }
        }
    } catch (e) { /* ignore */ }
    return 'evaluating';
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
    resolveDeployCommand,
    runDeployCommand,

    // ── eval file helpers ──
    parseEvalFileStatus,
});
