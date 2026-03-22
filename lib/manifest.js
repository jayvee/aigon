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

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

// Use process.cwd() so manifests are project-relative, not package-relative.
// When aigon is installed globally, __dirname points to the package, not the user's project.
function getRoot() { return process.cwd(); }
function getStateDir() { return path.join(getRoot(), '.aigon', 'state'); }
function getLocksDir() { return path.join(getRoot(), '.aigon', 'locks'); }

function canonicalFeatureId(id) {
    const raw = String(id);
    if (/^\d+$/.test(raw)) return String(parseInt(raw, 10)).padStart(2, '0');
    return raw;
}

function candidateFeatureIds(id) {
    const raw = String(id);
    if (!/^\d+$/.test(raw)) return [raw];
    const canonical = canonicalFeatureId(raw);
    const unpadded = String(parseInt(raw, 10));
    return [...new Set([canonical, unpadded])];
}

function coordinatorPath(id) {
    return path.join(getStateDir(), `feature-${canonicalFeatureId(id)}.json`);
}

function agentStatusPath(id, agent) {
    return path.join(getStateDir(), `feature-${canonicalFeatureId(id)}-${agent}.json`);
}

function lockPath(id) {
    return path.join(getLocksDir(), `feature-${canonicalFeatureId(id)}.lock`);
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
// Public API — Coordinator manifest
// ---------------------------------------------------------------------------

/**
 * Read the coordinator manifest for a feature.
 * Returns the stored manifest, or null if no file exists.
 *
 * @param {string|number} id - Feature ID
 * @returns {Object|null} Coordinator manifest, or null when missing/corrupt
 */
function readManifest(id) {
    for (const candidateId of candidateFeatureIds(id)) {
        const filePath = path.join(getStateDir(), `feature-${candidateId}.json`);
        if (!fs.existsSync(filePath)) continue;
        try {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (e) {
            return null;
        }
    }
    return null;
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
    for (const candidateId of candidateFeatureIds(id)) {
        const filePath = path.join(getStateDir(), `feature-${candidateId}-${agent}.json`);
        if (!fs.existsSync(filePath)) continue;
        try {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (e) {
            return null;
        }
    }
    return null;
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
    getStateDir,
    getLocksDir,
};
