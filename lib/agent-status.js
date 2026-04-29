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
const signalHealth = require('./signal-health');

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

function readAgentStatusRecordAt(repoPath, id, agent, options = {}) {
    const prefixes = Array.isArray(options.prefixes) && options.prefixes.length > 0
        ? options.prefixes
        : ['feature'];
    const stateDir = getStateDir({ mainRepoPath: repoPath });
    for (const prefix of prefixes) {
        for (const cid of candidateIds(id)) {
            const filePath = path.join(stateDir, `${prefix}-${cid}-${agent}.json`);
            if (!fs.existsSync(filePath)) continue;
            try {
                const raw = fs.readFileSync(filePath, 'utf8');
                return {
                    path: filePath,
                    prefix,
                    raw,
                    data: JSON.parse(raw),
                };
            } catch (_) {
                return {
                    path: filePath,
                    prefix,
                    raw: '',
                    data: {},
                };
            }
        }
    }
    return null;
}

function listAgentStatuses(repoPath, id, options = {}) {
    const prefixes = Array.isArray(options.prefixes) && options.prefixes.length > 0
        ? options.prefixes
        : ['feature'];
    const stateDir = getStateDir({ mainRepoPath: repoPath });
    let entries = [];
    try {
        entries = fs.readdirSync(stateDir);
    } catch (_) {
        return [];
    }

    const ids = new Set(candidateIds(id));
    const byAgent = new Map();
    entries.forEach(file => {
        const match = String(file).match(/^([a-z]+)-([^-]+)-([a-z0-9]+)\.json$/);
        if (!match) return;
        const [, prefix, fileId, agent] = match;
        if (!prefixes.includes(prefix) || !ids.has(fileId)) return;
        if (byAgent.has(agent)) return;
        const record = readAgentStatusRecordAt(repoPath, id, agent, { prefixes: [prefix] });
        if (record) byAgent.set(agent, record);
    });

    return Array.from(byAgent.entries())
        .sort((left, right) => left[0].localeCompare(right[0]))
        .map(([, record]) => record);
}

// Any per-agent status change other than `awaiting-input` itself clears the
// awaitingInput prompt — the agent has moved on, so the question is stale.
const AWAITING_INPUT_CLEARED_BY = new Set([
    'implementing', 'waiting', 'submitted', 'error',
    'reviewing', 'review-complete', 'feedback-addressed',
    // F404 lifecycle signal rename — accept new canonical names alongside aliases
    'revising', 'spec-reviewing',
    'implementation-complete', 'revision-complete', 'spec-review-complete', 'research-complete',
]);

function mergeAwaitingInput(existing, incoming) {
    if (Object.prototype.hasOwnProperty.call(incoming, 'awaitingInput')) {
        return incoming.awaitingInput;
    }
    if (incoming.status && AWAITING_INPUT_CLEARED_BY.has(incoming.status)) {
        return null;
    }
    return existing.awaitingInput || null;
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
    const nextAwaiting = mergeAwaitingInput(existing, data);
    if (nextAwaiting) record.awaitingInput = nextAwaiting;
    else delete record.awaitingInput;
    atomicWriteJSON(agentStatusPath(id, agent, prefix, options), record);
    const repoRoot = (options && options.mainRepoPath) || process.cwd();
    signalHealth.tryConsumeNudgeRecovery(repoRoot, prefix, id, agent, existing.status, record.status);
    signalHealth.recordSignalEvent({
        repoPath: options && options.mainRepoPath,
        kind: 'signal-emitted',
        agent,
        entityType: prefix === 'research' ? 'research' : 'feature',
        entityId: id,
        status: record.status,
        source: 'agent-status',
        runtimeAgentId: record.runtimeAgentId,
    });
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
    const nextAwaiting = mergeAwaitingInput(existing, data);
    if (nextAwaiting) record.awaitingInput = nextAwaiting;
    else delete record.awaitingInput;
    atomicWriteJSON(targetPath, record);
    signalHealth.tryConsumeNudgeRecovery(repoPath, prefix, id, agent, existing.status, record.status);
    signalHealth.recordSignalEvent({
        repoPath,
        kind: 'signal-emitted',
        agent,
        entityType: prefix === 'research' ? 'research' : 'feature',
        entityId: id,
        status: record.status,
        source: 'agent-status',
        runtimeAgentId: record.runtimeAgentId,
    });
    return record;
}

/**
 * Set or clear the awaitingInput prompt for an agent. Atomic with any status
 * already on the file — the awaitingInput field is updated, everything else
 * is preserved. Pass `null` message to clear.
 */
function writeAwaitingInput(repoPath, id, agent, message, prefix = 'feature') {
    const targetPath = path.join(repoPath, '.aigon', 'state', `${prefix}-${id}-${agent}.json`);
    let existing = {};
    try { existing = JSON.parse(fs.readFileSync(targetPath, 'utf8')); } catch (e) {}
    const record = Object.assign({}, existing, {
        agent,
        updatedAt: new Date().toISOString(),
    });
    if (message && String(message).trim()) {
        record.awaitingInput = { message: String(message), at: record.updatedAt };
    } else {
        delete record.awaitingInput;
    }
    atomicWriteJSON(targetPath, record);
    return record;
}

module.exports = {
    readAgentStatus,
    readAgentStatusRecordAt,
    listAgentStatuses,
    writeAgentStatus,
    writeAgentStatusAt,
    writeAwaitingInput,
    agentStatusPath,
    getStateDir,
    getLocksDir,
    canonicalId,
    candidateIds,
};
