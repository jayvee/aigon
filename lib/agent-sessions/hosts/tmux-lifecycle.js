'use strict';

// Detached tmux session creation with sidecar + capture sequencing (F632).

const { writeSessionSidecarRecord } = require('./tmux-sidecar');
const { attachSessionCapture } = require('./tmux-capture');

const _TMUX_HOST = './tmux';

function createDetachedTmuxSession(sessionName, cwd, command, meta) {
    const host = require(_TMUX_HOST).createTmuxSessionHost();
    const hostResult = host.startSession({
        sessionId: sessionName,
        sessionName,
        cwd,
        command,
        paths: {
            repoPath: meta && meta.repoPath,
            worktreePath: meta && (meta.worktreePath != null ? meta.worktreePath : cwd),
            cwd,
        },
        agent: meta && meta.agent ? { id: String(meta.agent) } : undefined,
        entityType: meta && meta.entityType,
        entityId: meta && meta.entityId,
        role: meta && meta.role,
        createdAt: meta && meta.createdAt,
    });
    const tmuxId = hostResult && hostResult.tmuxId != null ? hostResult.tmuxId : null;
    const shellPid = hostResult && hostResult.shellPid != null ? hostResult.shellPid : null;
    if (meta && meta.repoPath) {
        const resolvedWorktreePath = meta.worktreePath != null ? meta.worktreePath : cwd;
        const createdAt = meta.createdAt || new Date().toISOString();
        try {
            writeSessionSidecarRecord(Object.assign({}, meta, {
                sessionName,
                worktreePath: resolvedWorktreePath,
                tmuxId: meta.tmuxId || tmuxId,
                shellPid: Number.isFinite(meta.shellPid) ? meta.shellPid : shellPid,
                createdAt,
            }));
        } catch (_) { /* sidecar is best-effort */ }
        if (meta.agent) {
            attachSessionCapture(sessionName, {
                repoPath: meta.repoPath,
                worktreePath: resolvedWorktreePath,
                agent: meta.agent,
                entityType: meta.entityType,
                entityId: meta.entityId,
                role: meta.role,
                createdAt,
            });
        }
    }
    return { tmuxId, shellPid };
}

module.exports = {
    createDetachedTmuxSession,
};
