'use strict';

/**
 * Agent Status I/O
 *
 * Per-agent status files in .aigon/state/ — tracks agent submission state,
 * worktree paths, and other per-agent metadata.
 *
 *   Agent status: .aigon/state/{prefix}-{id}-{agent}.json
 *
 * Extracted from the former manifest.js as part of the workflow-core cutover.
 * The coordinator manifest and advisory locking have been removed — all
 * lifecycle state now lives in the workflow-core engine.
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function getRoot() { return process.cwd(); }

function getStateDir(options) {
    if (options && options.mainRepoPath) {
        return path.join(options.mainRepoPath, '.aigon', 'state');
    }
    return path.join(getRoot(), '.aigon', 'state');
}

function getLocksDir(options) {
    if (options && options.mainRepoPath) {
        return path.join(options.mainRepoPath, '.aigon', 'locks');
    }
    return path.join(getRoot(), '.aigon', 'locks');
}

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

function agentStatusPath(id, agent, prefix = 'feature', options) {
    return path.join(getStateDir(options), `${prefix}-${canonicalId(id)}-${agent}.json`);
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
// Public API
// ---------------------------------------------------------------------------

/**
 * Read the per-agent status file for an entity.
 * Returns null if the file does not exist.
 */
function readAgentStatus(id, agent, prefix = 'feature', options) {
    const stateDir = getStateDir(options);
    for (const cid of candidateIds(id)) {
        const filePath = path.join(stateDir, `${prefix}-${cid}-${agent}.json`);
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
 * Write the per-agent status file. Always stamps updatedAt.
 */
function writeAgentStatus(id, agent, data, prefix = 'feature', options) {
    const existing = readAgentStatus(id, agent, prefix, options) || {};
    const record = Object.assign({}, existing, data, {
        agent,
        updatedAt: new Date().toISOString(),
    });
    atomicWriteJSON(agentStatusPath(id, agent, prefix, options), record);
    return record;
}

/**
 * Write the per-agent status file to an arbitrary repo's .aigon/state/ dir.
 * Used by agents in worktrees to write status back to the main repo.
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

module.exports = {
    readAgentStatus,
    writeAgentStatus,
    writeAgentStatusAt,
    agentStatusPath,
    getStateDir,
    getLocksDir,
    canonicalId,
    candidateIds,
};
