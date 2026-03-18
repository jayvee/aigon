'use strict';

/**
 * Aigon Manifest I/O
 *
 * Per-feature JSON manifests in .aigon/state/ — the authoritative local state record.
 *
 *   Coordinator:  .aigon/state/feature-{id}.json
 *   Agent status: .aigon/state/feature-{id}-{agent}.json
 *   Lock:         .aigon/locks/feature-{id}.lock
 *
 * All I/O is synchronous and atomic where possible (write-to-temp + rename).
 * Locking is advisory (O_EXCL + PID file) with stale-lock detection.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

const ROOT_DIR = path.join(__dirname, '..');
const STATE_DIR = path.join(ROOT_DIR, '.aigon', 'state');
const LOCKS_DIR = path.join(ROOT_DIR, '.aigon', 'locks');
const SPECS_ROOT = path.join(ROOT_DIR, 'docs', 'specs');

const FEATURE_FOLDERS = [
    { folder: '01-inbox',         stage: 'inbox' },
    { folder: '02-backlog',       stage: 'backlog' },
    { folder: '03-in-progress',   stage: 'in-progress' },
    { folder: '04-in-evaluation', stage: 'in-evaluation' },
    { folder: '05-done',          stage: 'done' },
    { folder: '06-paused',        stage: 'paused' },
];

function coordinatorPath(id) {
    return path.join(STATE_DIR, `feature-${id}.json`);
}

function agentStatusPath(id, agent) {
    return path.join(STATE_DIR, `feature-${id}-${agent}.json`);
}

function lockPath(id) {
    return path.join(LOCKS_DIR, `feature-${id}.lock`);
}

// ---------------------------------------------------------------------------
// Atomic JSON write (write to temp, rename into place)
// ---------------------------------------------------------------------------

function atomicWriteJSON(filePath, data) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${filePath}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, filePath);
}

// ---------------------------------------------------------------------------
// Lazy bootstrap helpers
// ---------------------------------------------------------------------------

/**
 * Derive the stage for a feature by scanning the spec folders.
 * Returns { stage, specPath, name } or null if not found.
 */
function deriveFromFolder(id) {
    const paddedId = String(id).padStart(2, '0');
    const unpaddedId = String(parseInt(id, 10));
    const featureRoot = path.join(SPECS_ROOT, 'features');

    for (const { folder, stage } of FEATURE_FOLDERS) {
        const dir = path.join(featureRoot, folder);
        if (!fs.existsSync(dir)) continue;
        try {
            const files = fs.readdirSync(dir);
            for (const file of files) {
                const m = file.match(/^feature-(\d+)-(.+)\.md$/);
                if (!m) continue;
                if (m[1] === paddedId || m[1] === unpaddedId) {
                    return {
                        stage,
                        specPath: path.join(featureRoot, folder, file),
                        name: m[2],
                    };
                }
            }
        } catch (e) {
            // unreadable folder — skip
        }
    }
    return null;
}

/**
 * Find log files for a feature, returning agent-keyed entries.
 * Returns array of { agent, logPath }
 */
function findLogFiles(id) {
    const logsDir = path.join(SPECS_ROOT, 'features', 'logs');
    if (!fs.existsSync(logsDir)) return [];
    const paddedId = String(id).padStart(2, '0');
    const unpaddedId = String(parseInt(id, 10));
    const results = [];
    try {
        const files = fs.readdirSync(logsDir);
        for (const file of files) {
            const m = file.match(/^feature-(\d+)-(\w+)-[^/]+log\.md$/);
            if (!m) continue;
            if (m[1] === paddedId || m[1] === unpaddedId) {
                results.push({ agent: m[2], logPath: path.join(logsDir, file) });
            }
        }
    } catch (e) {
        // unreadable
    }
    return results;
}

/**
 * Probe git worktrees for a feature ID.
 * Returns array of { agent, worktreePath }
 */
function probeWorktrees(id) {
    const paddedId = String(id).padStart(2, '0');
    const unpaddedId = String(parseInt(id, 10));
    const results = [];
    try {
        const wtOutput = execSync('git worktree list', { encoding: 'utf8' });
        for (const line of wtOutput.split('\n')) {
            const m = line.match(/^([^\s]+)\s+/);
            if (!m) continue;
            const wtPath = m[1];
            const base = path.basename(wtPath);
            const wm = base.match(/^feature-(\d+)-(\w+)-(.+)$/);
            if (!wm) continue;
            if (wm[1] === paddedId || wm[1] === unpaddedId) {
                results.push({ agent: wm[2], worktreePath: wtPath });
            }
        }
    } catch (e) {
        // not in a repo or no worktrees
    }
    return results;
}

/**
 * Bootstrap a coordinator manifest from derived state.
 * Returns the new manifest object (not yet written — caller writes it).
 */
function bootstrapManifest(id) {
    const folderInfo = deriveFromFolder(id);
    const stage = folderInfo ? folderInfo.stage : 'unknown';
    const specPath = folderInfo ? folderInfo.specPath : null;
    const name = folderInfo ? folderInfo.name : null;

    // Discover agents from log files + worktrees
    const agentSet = new Set();
    const worktreeMap = {};
    for (const { agent, worktreePath } of probeWorktrees(id)) {
        agentSet.add(agent);
        worktreeMap[agent] = worktreePath;
    }
    for (const { agent } of findLogFiles(id)) {
        agentSet.add(agent);
    }

    const now = new Date().toISOString();

    return {
        id: String(id),
        type: 'feature',
        name: name || null,
        stage,
        specPath: specPath || null,
        agents: Array.from(agentSet),
        winner: null,
        pending: [],
        events: [
            { type: 'bootstrapped', at: now, actor: 'system' },
        ],
    };
}

// ---------------------------------------------------------------------------
// Public API — Coordinator manifest
// ---------------------------------------------------------------------------

/**
 * Read the coordinator manifest for a feature.
 * Lazy-bootstraps from folder/log/worktree state if no file exists yet.
 *
 * @param {string|number} id - Feature ID
 * @returns {Object} Coordinator manifest
 */
function readManifest(id) {
    const filePath = coordinatorPath(id);
    if (fs.existsSync(filePath)) {
        try {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (e) {
            // Corrupted file — fall through to bootstrap
        }
    }

    const manifest = bootstrapManifest(id);
    atomicWriteJSON(filePath, manifest);
    return manifest;
}

/**
 * Write (replace) the coordinator manifest, merging in a new event if provided.
 *
 * @param {string|number} id - Feature ID
 * @param {Object} data - Full manifest data or partial update
 * @param {Object} [event] - Optional event to append: { type, actor }
 */
function writeManifest(id, data, event) {
    const existing = fs.existsSync(coordinatorPath(id))
        ? (() => { try { return JSON.parse(fs.readFileSync(coordinatorPath(id), 'utf8')); } catch (e) { return {}; } })()
        : {};

    const now = new Date().toISOString();
    const events = Array.isArray(existing.events) ? [...existing.events] : [];

    if (event) {
        events.push({ type: event.type, at: now, actor: event.actor || 'system' });
    }

    const manifest = Object.assign({}, existing, data, { events });
    atomicWriteJSON(coordinatorPath(id), manifest);
    return manifest;
}

// ---------------------------------------------------------------------------
// Public API — Agent status
// ---------------------------------------------------------------------------

/**
 * Read the per-agent status file for a feature.
 * Returns null if the file does not exist.
 *
 * @param {string|number} id - Feature ID
 * @param {string} agent - Agent identifier (e.g. 'cc', 'cu')
 * @returns {Object|null}
 */
function readAgentStatus(id, agent) {
    const filePath = agentStatusPath(id, agent);
    if (!fs.existsSync(filePath)) return null;
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
        return null;
    }
}

/**
 * Write the per-agent status file.
 * Always stamps updatedAt.
 *
 * @param {string|number} id - Feature ID
 * @param {string} agent - Agent identifier
 * @param {Object} data - { status, worktreePath, ... }
 */
function writeAgentStatus(id, agent, data) {
    const existing = readAgentStatus(id, agent) || {};
    const record = Object.assign({}, existing, data, {
        agent,
        updatedAt: new Date().toISOString(),
    });
    atomicWriteJSON(agentStatusPath(id, agent), record);
    return record;
}

/**
 * Write the per-agent status file to an arbitrary repo's .aigon/state/ dir.
 * Used by agents in worktrees to write status back to the main repo.
 *
 * @param {string} repoPath - Absolute path to the target repo root
 * @param {string|number} id - Feature ID
 * @param {string} agent - Agent identifier
 * @param {Object} data - { status, worktreePath, ... }
 */
function writeAgentStatusAt(repoPath, id, agent, data) {
    const targetPath = path.join(repoPath, '.aigon', 'state', `feature-${id}-${agent}.json`);
    let existing = {};
    try { existing = JSON.parse(fs.readFileSync(targetPath, 'utf8')); } catch (e) {}
    const record = Object.assign({}, existing, data, {
        agent,
        updatedAt: new Date().toISOString(),
    });
    atomicWriteJSON(targetPath, record);
    return record;
}

// ---------------------------------------------------------------------------
// Public API — Advisory file locking
// ---------------------------------------------------------------------------

// Track locks acquired in this process so we can release on exit
const _heldLocks = new Set();

process.on('exit', () => {
    for (const id of _heldLocks) {
        try {
            const lp = lockPath(id);
            if (fs.existsSync(lp)) fs.unlinkSync(lp);
        } catch (e) {
            // best-effort
        }
    }
});

/**
 * Check whether a PID is still alive on this OS.
 * Returns false for unknown / non-existent PIDs.
 */
function isPidAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Acquire an advisory lock for a feature.
 * Returns true on success, false if already locked by a live process.
 * Removes stale locks (PID no longer alive).
 *
 * @param {string|number} id - Feature ID
 * @returns {boolean}
 */
function acquireLock(id) {
    const lp = lockPath(id);
    const dir = path.dirname(lp);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Check existing lock for staleness
    if (fs.existsSync(lp)) {
        try {
            const content = fs.readFileSync(lp, 'utf8').trim();
            const existingPid = parseInt(content, 10);
            if (!isNaN(existingPid) && isPidAlive(existingPid)) {
                return false; // Live lock held by another process
            }
            // Stale lock — remove it
            fs.unlinkSync(lp);
        } catch (e) {
            // Lock file disappeared between exists check and read — that's fine
        }
    }

    // O_EXCL: fail if file already exists (atomic create)
    try {
        const fd = fs.openSync(lp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL);
        fs.writeSync(fd, String(process.pid));
        fs.closeSync(fd);
        _heldLocks.add(id);
        return true;
    } catch (e) {
        if (e.code === 'EEXIST') return false; // Race: another process got it first
        throw e;
    }
}

/**
 * Release an advisory lock for a feature.
 * Only removes the lock if it was written by this process.
 *
 * @param {string|number} id - Feature ID
 */
function releaseLock(id) {
    const lp = lockPath(id);
    if (!fs.existsSync(lp)) {
        _heldLocks.delete(id);
        return;
    }
    try {
        const content = fs.readFileSync(lp, 'utf8').trim();
        const owner = parseInt(content, 10);
        if (!isNaN(owner) && owner === process.pid) {
            fs.unlinkSync(lp);
        }
    } catch (e) {
        // best-effort
    }
    _heldLocks.delete(id);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
    readManifest,
    writeManifest,
    readAgentStatus,
    writeAgentStatus,
    writeAgentStatusAt,
    acquireLock,
    releaseLock,
    // Path helpers exposed for testing
    coordinatorPath,
    agentStatusPath,
    lockPath,
    STATE_DIR,
    LOCKS_DIR,
};
