'use strict';

/**
 * Aigon Manifest I/O
 *
 * Per-entity JSON manifests in .aigon/state/ — the authoritative local state record.
 *
 *   Coordinator:  .aigon/state/{prefix}-{id}.json
 *   Agent status: .aigon/state/{prefix}-{id}-{agent}.json
 *   Lock:         .aigon/locks/{prefix}-{id}.lock
 *
 * The `prefix` parameter defaults to 'feature' for backward compatibility.
 * Research entities use prefix='research'.
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

function canonicalId(id) {
    const raw = String(id);
    if (/^\d+$/.test(raw)) return String(parseInt(raw, 10)).padStart(2, '0');
    return raw;
}

function candidateIds(id) {
    const raw = String(id);
    if (!/^\d+$/.test(raw)) return [raw];
    const canonical = canonicalId(raw);
    const unpadded = String(parseInt(raw, 10));
    return [...new Set([canonical, unpadded])];
}

function coordinatorPath(id, prefix = 'feature') {
    return path.join(getStateDir(), `${prefix}-${canonicalId(id)}.json`);
}

function agentStatusPath(id, agent, prefix = 'feature') {
    return path.join(getStateDir(), `${prefix}-${canonicalId(id)}-${agent}.json`);
}

function lockPath(id, prefix = 'feature') {
    return path.join(getLocksDir(), `${prefix}-${canonicalId(id)}.lock`);
}

// Backward-compat aliases (used in tests and older code)
const canonicalFeatureId = canonicalId;
const candidateFeatureIds = candidateIds;

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
 * Read the coordinator manifest for an entity.
 * Returns the stored manifest, or null if no file exists.
 *
 * @param {string|number} id - Entity ID
 * @param {string} [prefix='feature'] - Entity prefix ('feature' or 'research')
 * @returns {Object|null} Coordinator manifest, or null when missing/corrupt
 */
function readManifest(id, prefix = 'feature') {
    for (const cid of candidateIds(id)) {
        const filePath = path.join(getStateDir(), `${prefix}-${cid}.json`);
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
 * @param {string|number} id - Entity ID
 * @param {Object} data - Full manifest data or partial update
 * @param {Object} [event] - Optional event to append: { type, actor }
 * @param {string} [prefix='feature'] - Entity prefix ('feature' or 'research')
 */
function writeManifest(id, data, event, prefix = 'feature') {
    const coordPath = coordinatorPath(id, prefix);
    const existing = fs.existsSync(coordPath)
        ? (() => { try { return JSON.parse(fs.readFileSync(coordPath, 'utf8')); } catch (e) { return {}; } })()
        : {};

    const now = new Date().toISOString();
    const events = Array.isArray(existing.events) ? [...existing.events] : [];

    if (event) {
        events.push({ type: event.type, at: now, actor: event.actor || 'system' });
    }

    const manifest = Object.assign({}, existing, data, { events });
    atomicWriteJSON(coordPath, manifest);
    return manifest;
}

// ---------------------------------------------------------------------------
// Public API — Agent status
// ---------------------------------------------------------------------------

/**
 * Read the per-agent status file for an entity.
 * Returns null if the file does not exist.
 *
 * @param {string|number} id - Entity ID
 * @param {string} agent - Agent identifier (e.g. 'cc', 'cu')
 * @param {string} [prefix='feature'] - Entity prefix ('feature' or 'research')
 * @returns {Object|null}
 */
function readAgentStatus(id, agent, prefix = 'feature') {
    for (const cid of candidateIds(id)) {
        const filePath = path.join(getStateDir(), `${prefix}-${cid}-${agent}.json`);
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
 * @param {string|number} id - Entity ID
 * @param {string} agent - Agent identifier
 * @param {Object} data - { status, worktreePath, ... }
 * @param {string} [prefix='feature'] - Entity prefix ('feature' or 'research')
 */
function writeAgentStatus(id, agent, data, prefix = 'feature') {
    const existing = readAgentStatus(id, agent, prefix) || {};
    const record = Object.assign({}, existing, data, {
        agent,
        updatedAt: new Date().toISOString(),
    });
    atomicWriteJSON(agentStatusPath(id, agent, prefix), record);
    return record;
}

/**
 * Write the per-agent status file to an arbitrary repo's .aigon/state/ dir.
 * Used by agents in worktrees to write status back to the main repo.
 *
 * @param {string} repoPath - Absolute path to the target repo root
 * @param {string|number} id - Entity ID
 * @param {string} agent - Agent identifier
 * @param {Object} data - { status, worktreePath, ... }
 * @param {string} [prefix='feature'] - Entity prefix ('feature' or 'research')
 */
function writeAgentStatusAt(repoPath, id, agent, data, prefix = 'feature') {
    const targetPath = path.join(repoPath, '.aigon', 'state', `${prefix}-${id}-${agent}.json`);
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
    for (const lockKey of _heldLocks) {
        try {
            // lockKey is stored as "prefix:id" to support multi-entity locking
            const [pfx, lid] = lockKey.split(':');
            const lp = lockPath(lid, pfx);
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
 * Acquire an advisory lock for an entity.
 * Returns true on success, false if already locked by a live process.
 * Removes stale locks (PID no longer alive).
 *
 * @param {string|number} id - Entity ID
 * @param {string} [prefix='feature'] - Entity prefix ('feature' or 'research')
 * @returns {boolean}
 */
function acquireLock(id, prefix = 'feature') {
    const lp = lockPath(id, prefix);
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
        _heldLocks.add(`${prefix}:${id}`);
        return true;
    } catch (e) {
        if (e.code === 'EEXIST') return false; // Race: another process got it first
        throw e;
    }
}

/**
 * Release an advisory lock for an entity.
 * Only removes the lock if it was written by this process.
 *
 * @param {string|number} id - Entity ID
 * @param {string} [prefix='feature'] - Entity prefix ('feature' or 'research')
 */
function releaseLock(id, prefix = 'feature') {
    const lp = lockPath(id, prefix);
    if (!fs.existsSync(lp)) {
        _heldLocks.delete(`${prefix}:${id}`);
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
    _heldLocks.delete(`${prefix}:${id}`);
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
    // Backward-compat aliases
    canonicalFeatureId,
    candidateFeatureIds,
    // New canonical names
    canonicalId,
    candidateIds,
};
