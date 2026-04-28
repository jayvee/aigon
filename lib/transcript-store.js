'use strict';

/**
 * transcript-store — machine-global durable hot tier for agent session transcripts.
 *
 * Layout: ~/.aigon/transcripts/<repoName>/<entityType>/<entityId>/<agentId>/<role>-<sessionUuid>.{jsonl,meta.json}
 *
 * Feature 429: copies native transcript body at feature-close and agent-quarantine
 * moments so transcripts survive worktree deletion and native log rotation.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { resolveTelemetryDir } = require('./telemetry');
const agentRegistry = require('./agent-registry');

function resolveTranscriptBase() {
    return path.join(os.homedir(), '.aigon', 'transcripts');
}

function resolveTranscriptRepoDir(repoPath) {
    const repoName = path.basename(path.resolve(repoPath));
    return path.join(resolveTranscriptBase(), repoName);
}

function resolveTranscriptEntityDir(repoPath, entityType, entityId) {
    return path.join(resolveTranscriptRepoDir(repoPath), entityType, String(entityId));
}

/**
 * Find the most recent normalized telemetry record for a given entity/agent session.
 */
function _findTelemetryRecord(repoPath, entityType, entityId, agentId, sessionId) {
    const telemetryDir = resolveTelemetryDir(repoPath);
    if (!fs.existsSync(telemetryDir)) return null;
    let files;
    try { files = fs.readdirSync(telemetryDir); } catch (_) { return null; }

    const entityIdStr = String(entityId);
    const agentLower = String(agentId).toLowerCase();
    const matches = [];

    for (const file of files) {
        if (!file.endsWith('.json')) continue;
        let record;
        try { record = JSON.parse(fs.readFileSync(path.join(telemetryDir, file), 'utf8')); } catch (_) { continue; }
        if (!record || record.entityType !== entityType) continue;
        if (String(record.featureId) !== entityIdStr) continue;
        if (String(record.agent || '').toLowerCase() !== agentLower) continue;
        if (sessionId && record.sessionId !== sessionId) continue;
        matches.push(record);
    }

    if (!matches.length) return null;
    matches.sort((a, b) => (new Date(b.endAt || 0).getTime()) - (new Date(a.endAt || 0).getTime()));
    return matches[0];
}

/**
 * Write meta.json atomically alongside the copied transcript body.
 *
 * @param {string} metaPath   destination .meta.json path
 * @param {object} meta       meta record
 */
function _writeMeta(metaPath, meta) {
    const tmp = `${metaPath}.${process.pid}.tmp`;
    try {
        fs.writeFileSync(tmp, JSON.stringify(meta, null, 2) + '\n');
        fs.renameSync(tmp, metaPath);
    } catch (err) {
        try { fs.unlinkSync(tmp); } catch (_) {}
        throw err;
    }
}

/**
 * Copy a single session's native body to the durable hot tier and write its .meta.json.
 *
 * @param {string} repoPath
 * @param {string} entityType  'feature' | 'research'
 * @param {string} entityId
 * @param {string} agentId
 * @param {object} sidecar     session sidecar record (agentSessionId, agentSessionPath, ...)
 * @param {object|null} telemetryRecord  optional joined telemetry record
 * @param {string} [finalisedBy]  context label ('feature-close' | 'agent-quarantine')
 * @returns {{ durableBodyPath: string|null, metaPath: string, nativeBodyBytes: number }}
 */
function copySessionToDurable(repoPath, entityType, entityId, agentId, sidecar, telemetryRecord, finalisedBy = 'feature-close') {
    const sessionUuid = sidecar.agentSessionId;
    const role = (telemetryRecord && telemetryRecord.activity) || 'implement';
    const agentDir = path.join(resolveTranscriptEntityDir(repoPath, entityType, String(entityId)), agentId);
    fs.mkdirSync(agentDir, { recursive: true });

    const srcPath = sidecar.agentSessionPath;
    const ext = (srcPath && path.extname(srcPath)) || '.jsonl';
    const baseName = `${role}-${sessionUuid}`;
    const destBody = path.join(agentDir, `${baseName}${ext}`);
    const destMeta = path.join(agentDir, `${baseName}.meta.json`);

    let nativeBodyBytes = 0;
    let complete = false;
    let durableBodyPath = null;

    if (srcPath && fs.existsSync(srcPath)) {
        try {
            fs.copyFileSync(srcPath, destBody);
            nativeBodyBytes = fs.statSync(destBody).size;
            complete = true;
            durableBodyPath = destBody;
        } catch (_) { /* native file unavailable — write meta only */ }
    }

    const meta = {
        schemaVersion: 1,
        telemetryRef: telemetryRecord ? `${entityType}-${entityId}-${agentId}-${telemetryRecord.sessionId}` : null,
        sessionName: sidecar.sessionName || null,
        tmuxId: sidecar.sessionName || null,
        agentSessionId: sessionUuid,
        nativeBodyBytes,
        complete,
        finalisedAt: new Date().toISOString(),
        finalisedBy,
    };

    _writeMeta(destMeta, meta);
    return { durableBodyPath, metaPath: destMeta, nativeBodyBytes };
}

/**
 * Finalise all captured sessions for an entity at close time.
 * Iterates every sidecar in .aigon/sessions/ that matches the entity, copies each
 * to the hot tier, and writes .meta.json.
 *
 * @param {string} repoPath
 * @param {string} entityType  'feature' | 'research'
 * @param {string} entityId
 * @returns {{ copied: number, skipped: number }}
 */
function finaliseEntityTranscripts(repoPath, entityType, entityId) {
    const sidecarType = entityType === 'research' ? 'r' : 'f';
    const sessionsDir = path.join(path.resolve(repoPath), '.aigon', 'sessions');
    if (!fs.existsSync(sessionsDir)) return { copied: 0, skipped: 0 };

    let entries;
    try { entries = fs.readdirSync(sessionsDir); } catch (_) { return { copied: 0, skipped: 0 }; }

    const entityIdStr = String(entityId);
    let copied = 0;
    let skipped = 0;

    for (const f of entries) {
        if (!f.endsWith('.json')) continue;
        let sidecar;
        try { sidecar = JSON.parse(fs.readFileSync(path.join(sessionsDir, f), 'utf8')); } catch (_) { continue; }
        if (!sidecar || typeof sidecar !== 'object') continue;
        if (sidecar.entityType !== sidecarType) continue;
        if (String(sidecar.entityId) !== entityIdStr) continue;
        if (!sidecar.agentSessionId || !sidecar.agentSessionPath) { skipped++; continue; }
        if (!agentRegistry.getSessionStrategy(sidecar.agent)) { skipped++; continue; }

        const telemetry = _findTelemetryRecord(repoPath, entityType, entityIdStr, sidecar.agent, sidecar.agentSessionId);
        try {
            copySessionToDurable(repoPath, entityType, entityIdStr, sidecar.agent, sidecar, telemetry, 'feature-close');
            copied++;
        } catch (_) {
            skipped++;
        }
    }

    return { copied, skipped };
}

/**
 * Snapshot all currently-active sessions for a given agent into the quarantine
 * subdirectory. Called when `aigon agent quarantine <agentId> <modelId>` fires.
 *
 * Layout: ~/.aigon/transcripts/<repoName>/quarantine/<timestamp>-<model>/<agentId>/<role>-<sessionUuid>.{ext,meta.json}
 *
 * @param {string} repoPath
 * @param {string} agentId     'cc' | 'gg' | 'cx' | ...
 * @param {string} modelId     model identifier being quarantined
 * @returns {{ dir: string, copied: number, skipped: number }}
 */
function snapshotQuarantineTranscripts(repoPath, agentId, modelId) {
    const sessionsDir = path.join(path.resolve(repoPath), '.aigon', 'sessions');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const safeModel = modelId.replace(/[^a-zA-Z0-9._-]/g, '-');
    const quarantineDir = path.join(resolveTranscriptRepoDir(repoPath), 'quarantine', `${ts}-${safeModel}`);

    if (!fs.existsSync(sessionsDir)) return { dir: quarantineDir, copied: 0, skipped: 0 };

    let entries;
    try { entries = fs.readdirSync(sessionsDir); } catch (_) { return { dir: quarantineDir, copied: 0, skipped: 0 }; }

    let copied = 0;
    let skipped = 0;

    for (const f of entries) {
        if (!f.endsWith('.json')) continue;
        let sidecar;
        try { sidecar = JSON.parse(fs.readFileSync(path.join(sessionsDir, f), 'utf8')); } catch (_) { continue; }
        if (!sidecar || typeof sidecar !== 'object') continue;
        if (sidecar.agent !== agentId) continue;
        if (!sidecar.agentSessionId || !sidecar.agentSessionPath) { skipped++; continue; }

        const entityType = sidecar.entityType === 'r' ? 'research' : 'feature';
        const entityId = String(sidecar.entityId);
        const role = 'implement';
        const sessionUuid = sidecar.agentSessionId;
        const srcPath = sidecar.agentSessionPath;
        const ext = (srcPath && path.extname(srcPath)) || '.jsonl';
        const baseName = `${role}-${sessionUuid}`;
        const agentDir = path.join(quarantineDir, agentId);
        fs.mkdirSync(agentDir, { recursive: true });

        const destBody = path.join(agentDir, `${baseName}${ext}`);
        const destMeta = path.join(agentDir, `${baseName}.meta.json`);

        let nativeBodyBytes = 0;
        let complete = false;

        if (srcPath && fs.existsSync(srcPath)) {
            try {
                fs.copyFileSync(srcPath, destBody);
                nativeBodyBytes = fs.statSync(destBody).size;
                complete = true;
            } catch (_) {}
        }

        const meta = {
            schemaVersion: 1,
            telemetryRef: null,
            sessionName: sidecar.sessionName || null,
            tmuxId: sidecar.sessionName || null,
            agentSessionId: sessionUuid,
            agentId,
            entityType,
            entityId,
            quarantinedModel: modelId,
            nativeBodyBytes,
            complete,
            finalisedAt: new Date().toISOString(),
            finalisedBy: 'agent-quarantine',
        };

        try {
            _writeMeta(destMeta, meta);
            complete ? copied++ : skipped++;
        } catch (_) {
            skipped++;
        }
    }

    return { dir: quarantineDir, copied, skipped };
}

/**
 * Rename the transcript entity directory when a slug-keyed entity is promoted to
 * a numeric ID (during migrateEntityWorkflowIdSync). Called synchronously inside
 * the migration lock.
 *
 * @param {string} repoPath
 * @param {string} entityType  'feature' | 'research'
 * @param {string} fromId      slug or old id
 * @param {string} toId        new numeric id
 */
function renameTranscriptDirSync(repoPath, entityType, fromId, toId) {
    const fromDir = resolveTranscriptEntityDir(repoPath, entityType, String(fromId));
    const toDir = resolveTranscriptEntityDir(repoPath, entityType, String(toId));
    if (!fs.existsSync(fromDir)) return;
    if (fs.existsSync(toDir)) {
        // Collision: append suffix rather than silently overwriting
        const { createHash } = require('crypto');
        const sha = createHash('sha1').update(`${fromId}-${toId}-${Date.now()}`).digest('hex').slice(0, 8);
        const collisionDir = `${toDir}.collision-${sha}`;
        try { fs.renameSync(fromDir, collisionDir); } catch (_) {}
        return;
    }
    try {
        fs.mkdirSync(path.dirname(toDir), { recursive: true });
        fs.renameSync(fromDir, toDir);
    } catch (_) {}
}

/**
 * Resolve the durable hot-tier path for a session, if it exists.
 *
 * @param {string} repoPath
 * @param {string} entityType
 * @param {string} entityId
 * @param {string} agentId
 * @param {string} sessionUuid
 * @returns {string|null}  absolute path to the durable body file, or null
 */
function findDurablePath(repoPath, entityType, entityId, agentId, sessionUuid) {
    const agentDir = path.join(resolveTranscriptEntityDir(repoPath, entityType, String(entityId)), agentId);
    if (!fs.existsSync(agentDir)) return null;
    let entries;
    try { entries = fs.readdirSync(agentDir); } catch (_) { return null; }
    // Match any <role>-<sessionUuid>.<ext> that is NOT .meta.json
    const prefix = `-${sessionUuid}.`;
    for (const f of entries) {
        if (f.endsWith('.meta.json')) continue;
        if (f.includes(prefix)) return path.join(agentDir, f);
    }
    return null;
}

module.exports = {
    resolveTranscriptBase,
    resolveTranscriptRepoDir,
    resolveTranscriptEntityDir,
    copySessionToDurable,
    finaliseEntityTranscripts,
    snapshotQuarantineTranscripts,
    renameTranscriptDirSync,
    findDurablePath,
};
