'use strict';

const fs = require('fs');
const path = require('path');
const { readJsonSafe, writeJsonAtomic, ensureDir } = require('../io/json');
const { ERROR_CODES, createAgentSessionError } = require('./errors');
const { normalizeAgentSessionRecord, SESSION_CATEGORIES } = require('./model');
const { validateSessionEvent } = require('./events');

function createAgentSessionStore({ repoPath = process.cwd(), sessionsDir = null } = {}) {
    const rootDir = sessionsDir || path.join(repoPath, '.aigon', 'sessions');
    const eventsPath = path.join(rootDir, 'events.jsonl');

    function getRecordPath(sessionId) {
        if (!sessionId || typeof sessionId !== 'string') {
            throw createAgentSessionError(ERROR_CODES.INVALID_REQUEST, 'Missing session id');
        }
        return path.join(rootDir, sessionId + '.json');
    }

    function readSession(sessionRef) {
        const sessionId = typeof sessionRef === 'string' ? sessionRef : sessionRef && sessionRef.sessionId;
        const recordPath = getRecordPath(sessionId);
        const raw = readJsonSafe(recordPath, null);
        if (!raw) return null;
        return normalizeAgentSessionRecord(raw, recordPath);
    }

    function writeSession(record) {
        const normalized = normalizeAgentSessionRecord(record, 'writeSession');
        writeJsonAtomic(getRecordPath(normalized.sessionId), toSidecarShape(normalized));
        return normalized;
    }

    function listSessions(filter = {}) {
        let entries = [];
        try {
            entries = fs.readdirSync(rootDir, { withFileTypes: true });
        } catch (_) {
            return [];
        }
        return entries
            .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
            .map((entry) => readJsonSafe(path.join(rootDir, entry.name), null))
            .filter(Boolean)
            .map((raw) => {
                // Enumeration must tolerate sidecar shapes the model does not own
                // (e.g. set-conductor `entityType: 'S'` or agent-less `auto` sessions
                // written by writeSessionSidecarRecord). Skip un-normalizable records
                // instead of throwing the whole listing, matching loadSessionSidecarIndex.
                try {
                    return normalizeAgentSessionRecord(raw, path.join(rootDir, raw.sessionName || raw.sessionId || 'unknown'));
                } catch (_) {
                    return null;
                }
            })
            .filter(Boolean)
            .filter((record) => matchesFilter(record, filter));
    }

    function deleteSession(sessionRef) {
        const sessionId = typeof sessionRef === 'string' ? sessionRef : sessionRef && sessionRef.sessionId;
        const recordPath = getRecordPath(sessionId);
        try {
            fs.unlinkSync(recordPath);
            return true;
        } catch (err) {
            if (err && err.code === 'ENOENT') return false;
            throw err;
        }
    }

    function appendEvent(event) {
        const normalized = validateSessionEvent(event);
        ensureDir(rootDir);
        fs.appendFileSync(eventsPath, JSON.stringify(normalized) + '\n');
        return normalized;
    }

    function readEvents() {
        try {
            const body = fs.readFileSync(eventsPath, 'utf8');
            return body.split('\n')
                .map((line) => line.trim())
                .filter(Boolean)
                .map((line) => {
                    try {
                        return JSON.parse(line);
                    } catch (_) {
                        return null;
                    }
                })
                .filter(Boolean);
        } catch (err) {
            if (err && err.code === 'ENOENT') return [];
            throw err;
        }
    }

    return {
        rootDir,
        getRecordPath,
        readSession,
        writeSession,
        listSessions,
        deleteSession,
        appendEvent,
        readEvents,
    };
}

function matchesFilter(record, filter) {
    if (!filter || Object.keys(filter).length === 0) return true;
    if (filter.category && record.category !== filter.category) return false;
    if (filter.state && record.state !== filter.state) return false;
    if (filter.role !== undefined && record.role !== filter.role) return false;
    if (filter.agentId && (!record.agent || record.agent.id !== filter.agentId)) return false;
    if (filter.entity) {
        if (!record.entity) return false;
        if (filter.entity.type && record.entity.type !== filter.entity.type) return false;
        if (filter.entity.id && record.entity.id !== String(filter.entity.id)) return false;
    }
    return true;
}

function toSidecarShape(record) {
    const normalized = normalizeAgentSessionRecord(record, 'sidecarShape');
    const hostHandle = normalized.host && normalized.host.kind === 'tmux'
        ? normalized.host.handle || {}
        : {};
    const binding = normalized.transcriptBinding || {};
    const entityType = normalized.category === SESSION_CATEGORIES.ENTITY && normalized.entity
        ? toLegacyEntityType(normalized.entity.type)
        : null;
    return {
        ...normalized,
        sessionName: normalized.sessionName || normalized.sessionId,
        category: normalized.category,
        repoPath: normalized.paths && normalized.paths.repoPath,
        worktreePath: normalized.paths && normalized.paths.worktreePath,
        cwd: normalized.paths && normalized.paths.cwd,
        // Legacy readers expect `agent` to be a bare string id: session-sidecar.js
        // does `raw.agent !== agentId` (transcript resume) and worktree.js does
        // `String(side.agent)`. Writing the model object here yields "[object Object]"
        // and breaks both, so persist the string id and round-trip the slot fields
        // separately (normalizeAgent reads `slotAgentId`/`runtimeAgentId` back in).
        agent: normalized.agent ? normalized.agent.id : null,
        slotAgentId: normalized.agent ? normalized.agent.slotAgentId : undefined,
        runtimeAgentId: normalized.agent ? normalized.agent.runtimeAgentId : undefined,
        tmuxId: normalized.tmuxId || hostHandle.tmuxId,
        shellPid: normalized.shellPid || hostHandle.shellPid,
        entityType,
        entityId: normalized.entity ? normalized.entity.id : null,
        role: normalized.category === SESSION_CATEGORIES.REPO ? null : normalized.role,
        agentSessionId: normalized.agentSessionId || binding.providerSessionId,
        agentSessionPath: normalized.agentSessionPath || binding.path,
        agentSessionProvider: normalized.agentSessionProvider || binding.provider,
        agentSessionCapturedAt: normalized.agentSessionCapturedAt || binding.capturedAt,
    };
}

function toLegacyEntityType(entityType) {
    if (entityType === 'feature') return 'f';
    if (entityType === 'research') return 'r';
    if (entityType === 'set') return 'S';
    return entityType;
}

module.exports = {
    createAgentSessionStore,
    toSidecarShape,
};
