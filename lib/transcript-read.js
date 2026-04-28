'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { readLatestSidecarWithSession } = require('./session-sidecar');
const { resolveTelemetryDir } = require('./telemetry');
const agentRegistry = require('./agent-registry');
const transcriptStore = require('./transcript-store');

/**
 * Build a structured "not captured" record for agents or sessions that
 * do not support transcript capture (cu/op/km) or pre-date F357.
 */
function buildNotCapturedRecord(agentId, reason) {
    const agentName = agentRegistry.getAgent(agentId)?.displayName || agentId;
    return {
        captured: false,
        agent: agentId,
        agentName,
        reason: reason || `Transcript capture is not supported for ${agentName}.`,
    };
}

/**
 * Find the most recent normalized telemetry record for a given entity/agent
 * session. Joins on sessionId when available, otherwise falls back to
 * featureId + agent match.
 */
function findTelemetryForSession(repoPath, entityType, entityId, agentId, sessionId) {
    const telemetryDir = resolveTelemetryDir(repoPath);
    if (!fs.existsSync(telemetryDir)) return null;

    let files;
    try {
        files = fs.readdirSync(telemetryDir);
    } catch (_) { return null; }

    const entityIdStr = String(entityId);
    const agentLower = String(agentId).toLowerCase();
    const matches = [];

    for (const file of files) {
        if (!file.endsWith('.json')) continue;
        let record;
        try {
            record = JSON.parse(fs.readFileSync(path.join(telemetryDir, file), 'utf8'));
        } catch (_) { continue; }
        if (!record || record.entityType !== entityType) continue;
        if (String(record.featureId) !== entityIdStr) continue;
        if (String(record.agent || '').toLowerCase() !== agentLower) continue;
        if (sessionId && record.sessionId !== sessionId) continue;
        matches.push(record);
    }

    if (matches.length === 0) return null;
    matches.sort((a, b) => {
        const ta = a.endAt ? new Date(a.endAt).getTime() : 0;
        const tb = b.endAt ? new Date(b.endAt).getTime() : 0;
        return tb - ta;
    });
    return matches[0];
}

/**
 * Collect transcript records for an entity, optionally filtered to one agent.
 *
 * @param {string} repoPath
 * @param {string} entityType  'feature' | 'research'
 * @param {string} entityId    padded or unpadded numeric id
 * @param {string|null} agentId optional agent filter
 * @returns {object[]}
 */
function collectTranscriptRecords(repoPath, entityType, entityId, agentId) {
    const sidecarType = entityType === 'research' ? 'r' : 'f';
    const sessionsDir = path.join(path.resolve(repoPath), '.aigon', 'sessions');
    if (!fs.existsSync(sessionsDir)) return [];

    let entries;
    try {
        entries = fs.readdirSync(sessionsDir);
    } catch (_) { return []; }

    const entityIdStr = String(entityId);
    const results = [];

    for (const f of entries) {
        if (!f.endsWith('.json')) continue;
        let raw;
        try {
            raw = JSON.parse(fs.readFileSync(path.join(sessionsDir, f), 'utf8'));
        } catch (_) { continue; }
        if (!raw || typeof raw !== 'object') continue;
        if (raw.entityType !== sidecarType) continue;
        if (String(raw.entityId) !== entityIdStr) continue;
        if (agentId && raw.agent !== agentId) continue;

        const thisAgentId = raw.agent;
        if (!thisAgentId) continue;

        const strategy = agentRegistry.getSessionStrategy(thisAgentId);
        if (!strategy) {
            // F430: if a tmux log was captured for this non-native agent, surface it
            if (raw.tmuxLogPath && fs.existsSync(raw.tmuxLogPath)) {
                const agentName = agentRegistry.getAgent(thisAgentId)?.displayName || thisAgentId;
                results.push({
                    captured: true,
                    agent: thisAgentId,
                    agentName,
                    agentSessionId: null,
                    agentSessionPath: raw.tmuxLogPath,
                    durablePath: null,
                    tmuxLogPath: raw.tmuxLogPath,
                    sessionName: raw.sessionName || null,
                    worktreePath: raw.worktreePath || null,
                    createdAt: raw.createdAt || null,
                    telemetry: null,
                });
            } else {
                results.push(buildNotCapturedRecord(thisAgentId, `Transcript capture is not supported for ${thisAgentId}.`));
            }
            continue;
        }

        if (!raw.agentSessionId || !raw.agentSessionPath) {
            results.push(buildNotCapturedRecord(thisAgentId, 'Session was started before transcript capture was enabled (pre-F357).'));
            continue;
        }

        const telemetry = findTelemetryForSession(repoPath, entityType, entityIdStr, thisAgentId, raw.agentSessionId);

        // Prefer durable hot-tier copy when available; fall back to live agentSessionPath.
        const durablePath = transcriptStore.findDurablePath(repoPath, entityType, entityIdStr, thisAgentId, raw.agentSessionId);

        results.push({
            captured: true,
            agent: thisAgentId,
            agentName: agentRegistry.getAgent(thisAgentId)?.displayName || thisAgentId,
            agentSessionId: raw.agentSessionId,
            agentSessionPath: durablePath || raw.agentSessionPath,
            durablePath: durablePath || null,
            tmuxLogPath: raw.tmuxLogPath || null,
            sessionName: raw.sessionName || null,
            worktreePath: raw.worktreePath || null,
            createdAt: raw.createdAt || null,
            telemetry: telemetry ? {
                model: telemetry.model || null,
                turnCount: telemetry.turnCount,
                toolCalls: telemetry.toolCalls,
                tokenUsage: telemetry.tokenUsage || null,
                costUsd: telemetry.costUsd,
                startAt: telemetry.startAt,
                endAt: telemetry.endAt,
            } : null,
        });
    }

    return results;
}

/**
 * Resolve a filesystem path for server-mediated transcript download.
 * Paths come only from collectTranscriptRecords — never from the client.
 *
 * @param {string} repoPath
 * @param {string} entityType
 * @param {string} entityId
 * @param {{ agent: string, sessionId?: string|null, sessionName?: string|null }} query
 * @returns {{ ok: true, absPath: string, downloadBaseName: string } | { ok: false, status: number, error: string }}
 */
function resolveTranscriptDownload(repoPath, entityType, entityId, query) {
    const agentNorm = String((query && query.agent) || '').trim().toLowerCase();
    if (!agentNorm) {
        return { ok: false, status: 400, error: 'agent query parameter is required' };
    }
    const records = collectTranscriptRecords(repoPath, entityType, entityId, agentNorm);
    let candidates = records.filter(r =>
        r.captured === true &&
        typeof r.agentSessionPath === 'string' &&
        r.agentSessionPath.length > 0
    );
    candidates = candidates.filter(r => {
        try {
            return fs.existsSync(r.agentSessionPath);
        } catch (_) {
            return false;
        }
    });
    const sid = query && query.sessionId ? String(query.sessionId).trim() : '';
    const sname = query && query.sessionName ? String(query.sessionName).trim() : '';
    let match = null;
    if (sid) {
        match = candidates.find(r => r.agentSessionId === sid);
    } else if (sname) {
        match = candidates.find(r => r.sessionName === sname);
    } else if (candidates.length === 1) {
        match = candidates[0];
    } else if (candidates.length > 1) {
        match = [...candidates].sort((a, b) => {
            const ta = new Date(a.createdAt || 0).getTime();
            const tb = new Date(b.createdAt || 0).getTime();
            return tb - ta;
        })[0];
    }
    if (!match) {
        return { ok: false, status: 404, error: 'Transcript file not found for this agent/session.' };
    }
    const downloadBaseName = path.basename(match.agentSessionPath) || 'transcript';
    return { ok: true, absPath: match.agentSessionPath, downloadBaseName };
}

/**
 * Format transcript records for CLI output.
 *
 * @param {object[]} records
 * @param {string} entityType
 * @param {string} entityId
 * @returns {string}
 */
function formatTranscriptCliOutput(records, entityType, entityId) {
    const lines = [`\n📄 Transcripts for ${entityType} ${entityId}\n`];
    for (const r of records) {
        if (r.captured) {
            const tel = r.telemetry;
            const telLine = tel
                ? ` | model: ${tel.model || 'n/a'} | turns: ${tel.turnCount} | cost: $${tel.costUsd ?? 'n/a'}`
                : '';
            lines.push(`  ${r.agentName}: ${r.agentSessionPath}${telLine}`);
        } else {
            lines.push(`  ${r.agentName}: ${r.reason}`);
        }
    }
    lines.push('');
    return lines.join('\n');
}

/**
 * Open a transcript path in the user's default editor/viewer.
 *
 * @param {string} filePath
 * @returns {{ok: boolean, openedWith?: string, error?: string}}
 */
function openTranscriptPath(filePath) {
    const editor = process.env.EDITOR;
    let cmd, cmdArgs;
    if (editor) {
        cmd = editor;
        cmdArgs = [filePath];
    } else if (process.platform === 'darwin') {
        cmd = 'open';
        cmdArgs = [filePath];
    } else if (process.platform === 'win32') {
        cmd = 'cmd';
        cmdArgs = ['/c', 'start', '', filePath];
    } else {
        cmd = 'xdg-open';
        cmdArgs = [filePath];
    }

    try {
        spawn(cmd, cmdArgs, { detached: true, stdio: 'ignore' }).unref();
        return { ok: true, openedWith: cmd };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

module.exports = {
    collectTranscriptRecords,
    resolveTranscriptDownload,
    formatTranscriptCliOutput,
    openTranscriptPath,
};
