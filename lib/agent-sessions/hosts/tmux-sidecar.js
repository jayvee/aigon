'use strict';

// Sidecar persistence for tmux sessions (F632). Write path for `.aigon/sessions/*.json`.

const fs = require('fs');
const path = require('path');
const { toUnpaddedId } = require('../names');

function safeWrite(filePath, content) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content);
}

/**
 * Persist tmux session sidecar under `.aigon/sessions/{sessionName}.json`.
 */
function writeSessionSidecarRecord(meta) {
    const sessionName = meta.sessionName;
    if (!sessionName || !meta.repoPath) return;
    const category = meta.category === 'repo' ? 'repo' : 'entity';
    const record = {
        category,
        sessionName,
        repoPath: path.resolve(meta.repoPath),
        worktreePath: path.resolve(meta.worktreePath || process.cwd()),
        createdAt: meta.createdAt || new Date().toISOString(),
        agent: meta.agent != null ? String(meta.agent) : null,
    };
    if (meta.tmuxId) record.tmuxId = String(meta.tmuxId);
    if (Number.isFinite(meta.shellPid)) record.shellPid = meta.shellPid;
    if (category === 'entity') {
        const et = meta.entityType;
        if (et !== 'f' && et !== 'r' && et !== 'S') return;
        if (meta.entityId == null || String(meta.entityId).trim() === '') return;
        record.entityType = et;
        record.entityId = toUnpaddedId(String(meta.entityId));
        record.role = String(meta.role || 'do');
    }
    if (meta.metadata && typeof meta.metadata === 'object' && !Array.isArray(meta.metadata)) {
        record.metadata = meta.metadata;
    }
    const dir = path.join(path.resolve(meta.repoPath), '.aigon', 'sessions');
    safeWrite(path.join(dir, `${sessionName}.json`), JSON.stringify(record, null, 2));
}

module.exports = {
    writeSessionSidecarRecord,
};
